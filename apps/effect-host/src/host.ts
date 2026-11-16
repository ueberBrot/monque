import { createServer } from "node:http";
import { Monque } from "@monque/core";
import type { MonqueOptions } from "@monque/core";
import { createDashboardExpressRouter } from "@monque/dashboard-express";
import { createManagementExpressRouter } from "@monque/management-express";
import { Context, Effect, Predicate } from "effect";
import express from "express";
import type { RequestHandler } from "express";
import { MongoClient } from "mongodb";

import { HostError } from "./host-error.js";
import { validateOptions } from "./options.js";
import type { HostOptions } from "./options.js";

class Receipts extends Context.Service<
  Receipts,
  {
    readonly record: (jobId: string) => Effect.Effect<void, Error>;
  }
>()("effect-host/Receipts") {}

const listen = (app: express.Express, port: number) =>
  Effect.gen(function* listenHttp() {
    const server = yield* Effect.acquireDisposable(
      Effect.sync(() =>
        createServer((req, res) => {
          app(req, res);
        }),
      ),
    );

    return yield* Effect.callback<ReturnType<typeof createServer>, HostError>((resume) => {
      server.once("error", (error) => {
        resume(Effect.fail(new HostError({ message: error.message })));
      });
      server.listen(port, "127.0.0.1", () => {
        resume(Effect.succeed(server));
      });
    });
  });

export const host = (options: HostOptions) =>
  Effect.gen(function* acquireHost() {
    yield* validateOptions(options);

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

    const app = express();
    app.disable("x-powered-by");

    const operatorCredential = Buffer.from(`operator:${options.operatorPassword}`).toString(
      "base64",
    );

    const viewerCredential = Buffer.from(`viewer:${options.viewerPassword}`).toString("base64");
    const operator = `Basic ${operatorCredential}`;
    const viewer = `Basic ${viewerCredential}`;

    const authenticate: RequestHandler = (req, res, next) => {
      const authorization = req.get("authorization");

      if (authorization !== operator && authorization !== viewer) {
        res.setHeader("WWW-Authenticate", 'Basic realm="Monque", charset="UTF-8"');
        res.status(401).json({ error: "Authentication required" });

        return;
      }

      res.locals["role"] = authorization === operator ? "operator" : "viewer";
      next();
    };

    app.use(
      options.managementPath,
      authenticate,
      createManagementExpressRouter<{ role: string }>({
        monque,
        readOnly: options.readOnly ?? false,
        context: ({ res }) => ({ role: String(res.locals["role"]) }),
        authorize: ({ action, context }) =>
          action === "read" ||
          (context.role === "operator" && action !== "delete" && action !== "deleteBulk"),
      }),
    );
    app.use(
      options.dashboardPath,
      authenticate,
      createDashboardExpressRouter({
        apiBaseUrl: options.managementPath,
      }),
    );
    const server = yield* listen(app, options.port);
    const address = server.address();

    if (address === null || Predicate.isString(address)) {
      return yield* new HostError({ message: "Expected a TCP listener" });
    }

    return {
      url: `http://127.0.0.1:${address.port}`,
      monque,
      db,
      client,
      jobId: job._id.toHexString(),
    };
  });
