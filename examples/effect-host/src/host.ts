// @effect-diagnostics unstableApiUsage:off
/* oxlint-disable eslint/max-classes-per-file, sonarjs/no-nested-functions -- Application identity and Worker dependencies are local to this composition. */
import { BunHttpServer } from "@effect/platform-bun";
import type { MonqueOptions } from "@monque/core";
import { Monque } from "@monque/core/effect";
import { dashboardEffectLayer } from "@monque/dashboard-effect";
import { createManagementEffectRoutes } from "@monque/management-effect";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { MongoClient } from "mongodb";

import { HostError } from "./host-error.js";
import { validateOptions } from "./options.js";
import type { HostOptions } from "./options.js";

class Identity extends Context.Service<Identity, { readonly role: "operator" | "viewer" }>()(
  "effect-host/Identity",
) {}

class Receipts extends Context.Service<
  Receipts,
  {
    readonly record: (jobId: string) => Effect.Effect<void, Error>;
  }
>()("effect-host/Receipts") {}

const acquireHost = (options: HostOptions) =>
  Effect.gen(function* acquireResources() {
    yield* validateOptions(options);

    yield* Effect.addFinalizer(() => Effect.log("Released MongoDB"));

    // Register release before connect so a failed acquisition also closes its client.
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new MongoClient(options.mongoUri, { serverSelectionTimeoutMS: 5000 })),
      (connection) =>
        Effect.promise(async () => {
          await connection.close();
        }),
    );

    yield* Effect.tryPromise(async () => await client.connect());
    const db = client.db(options.databaseName);
    const schedulerOptions: MonqueOptions = { pollInterval: 100, shutdownTimeout: 5000 };

    if (options.instrumentation) {
      schedulerOptions.instrumentation = options.instrumentation;
    }

    yield* Effect.addFinalizer(() => Effect.log("Released Monque"));
    const monque = yield* Monque.scoped(db, schedulerOptions);
    yield* monque.effects
      .register("receipt", (job) =>
        Effect.gen(function* processReceipt() {
          const receipts = yield* Receipts;
          yield* receipts.record(job._id.toHexString());
        }),
      )
      .pipe(
        Effect.provideService(Receipts, {
          record: (jobId) =>
            Effect.tryPromise(async () => {
              // A retry after a crash must not duplicate this application's receipt.
              await db
                .collection<{ _id: string; processed: boolean }>("receipts")
                .updateOne({ _id: jobId }, { $set: { processed: true } }, { upsert: true });
            }),
        }),
      );
    const job = yield* monque.effects.enqueue("receipt", { message: "Hello from Effect" });
    yield* monque.effects.start;

    const operatorCredential = Buffer.from(`operator:${options.operatorPassword}`).toString(
      "base64",
    );

    const viewerCredential = Buffer.from(`viewer:${options.viewerPassword}`).toString("base64");
    const operator = `Basic ${operatorCredential}`;
    const viewer = `Basic ${viewerCredential}`;

    const authentication = HttpRouter.middleware<{ provides: Identity }>()((next) =>
      Effect.gen(function* authenticate() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { authorization } = request.headers;

        if (authorization !== operator && authorization !== viewer) {
          return HttpServerResponse.jsonUnsafe(
            { error: "Authentication required" },
            {
              status: 401,
              headers: { "www-authenticate": 'Basic realm="Monque", charset="UTF-8"' },
            },
          );
        }

        yield* Effect.log("Request started", request.method, request.url);
        yield* Effect.addFinalizer(() =>
          Effect.log("Request finished", request.method, request.url),
        );

        return yield* next.pipe(
          Effect.provideService(Identity, {
            role: authorization === operator ? "operator" : "viewer",
          }),
        );
      }),
    );

    const routes = Layer.mergeAll(
      createManagementEffectRoutes({
        monque: monque.effects,
        // SAFETY: validateOptions checks the absolute mount; retain the portable adapter's template type.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Validated by validateOptions before acquisition.
        prefix: options.managementPath as `/${string}`,
        readOnly: options.readOnly ?? false,
        context: () => Identity,
        authorize:
          options.authorize ??
          (({ action, context }) =>
            Effect.succeed(
              action === "read" ||
                (context.role === "operator" && action !== "delete" && action !== "deleteBulk"),
            )),
      }),
      dashboardEffectLayer({
        basePath: options.dashboardPath,
        apiBaseUrl: options.managementPath,
        pollingIntervalMs: 1000,
      }),
    ).pipe(
      Layer.provide(authentication.layer),
      HttpRouter.provideRequest(BunHttpServer.layerHttpServices),
    );

    const handler = yield* HttpRouter.toHttpEffect(routes);
    // Sequential acquisition makes HTTP fibers finish before shared resources close.
    yield* Effect.addFinalizer(() => Effect.log("Released HTTP"));

    const server = yield* BunHttpServer.make({
      hostname: "127.0.0.1",
      port: options.port,
      gracefulShutdownTimeout: 1000,
      idleTimeout: 30,
    });

    yield* server.serve(handler);
    const { address } = server;

    if (address._tag === "UnixPathAddress") {
      return yield* new HostError({ message: "Expected a TCP listener" });
    }

    return {
      monque,
      db,
      client,
      url: `http://127.0.0.1:${address.port}`,
      jobId: job._id.toHexString(),
    };
  });

/** Own ordering even when an embedding application uses parallel finalization. */
export const host = (options: HostOptions) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* scopedHost() {
      const parent = yield* Effect.scope;
      const scope = yield* Scope.fork(parent, "sequential");

      return yield* restore(acquireHost(options).pipe(Scope.provide(scope))).pipe(
        Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
      );
    }),
  );
