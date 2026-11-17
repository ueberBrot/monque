// @effect-diagnostics unstableApiUsage:off
import { describe, expect, it } from "@effect/vitest";
import type { ProcessingStateDto } from "@monque/management";
import { ORPCError } from "@orpc/client";
import { createEffectClient } from "@orpc/effect";
import { Deferred, Effect, Fiber } from "effect";

import { startHost } from "./host";
import type { ManagementTestHost } from "./host";

const bounded = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.timeout(2000));

it.live("RPC reaches native processing state with the existing HTTP DTO", () =>
  Effect.gen(function* processingState() {
    const host = yield* startHost();
    const client = createEffectClient(host.client("alice"));
    expect(yield* client.processingState()).toStrictEqual({
      instanceId: "proof-686",
      paused: false,
      globallyPaused: false,
    });
  }),
);

describe.each(["rpc", "http"] as const)("%s", (transport) => {
  const call = (
    host: ManagementTestHost,
    identity: string,
    signal?: AbortSignal,
  ): Effect.Effect<ProcessingStateDto | { status: number; body: unknown }, unknown> => {
    if (transport === "rpc") {
      return createEffectClient(host.client(identity)).processingState(undefined, { signal });
    }

    return Effect.tryPromise(async () => {
      const response = await fetch(`${host.url}/api/v1/processing`, {
        headers: { "x-identity": identity },
        signal: signal ?? null,
      });

      const body: unknown = await response.json();

      return { status: response.status, body };
    });
  };

  it.live("preserves results, denial envelopes, request finalizers and tracing", () =>
    Effect.gen(function* requestLifecycle() {
      const host = yield* startHost();
      const dto = { instanceId: "proof-686", paused: false, globallyPaused: false };
      expect(yield* call(host, "alice")).toStrictEqual(
        transport === "rpc" ? dto : { status: 200, body: dto },
      );

      if (transport === "rpc") {
        expect(yield* Effect.flip(call(host, "denied"))).toMatchObject({
          code: "FORBIDDEN",
          message: "Denied",
        });
      } else {
        expect(yield* call(host, "denied")).toStrictEqual({
          status: 403,
          body: { error: "Denied" },
        });
      }

      expect(host.events).toStrictEqual([
        "entered:alice",
        "finalized:alice",
        "entered:denied",
        "finalized:denied",
      ]);

      for (const trace of host.traces) {
        expect(trace.parent).toBe(trace.host);
        expect(trace.trace).toBe(trace.hostTrace);
      }
    }),
  );

  it.live.each([
    new Error("private defect"),
    new ORPCError("FORBIDDEN", { message: "private defect" }),
  ])("keeps defects internal and releases request resources (%s)", (defect) =>
    Effect.gen(function* defectIsolation() {
      const host = yield* startHost({ beforeAuthorize: () => Effect.die(defect) });

      if (transport === "rpc") {
        expect(yield* Effect.flip(call(host, "alice"))).toMatchObject({
          code: "INTERNAL_SERVER_ERROR",
          message: "Internal Server Error",
        });
      } else {
        expect(yield* call(host, "alice")).toStrictEqual({
          status: 500,
          body: { error: "Internal server error" },
        });
      }

      expect(host.events).toStrictEqual(["entered:alice", "finalized:alice"]);
    }),
  );

  it.live("retains distinct identities across overlapping requests", () =>
    Effect.gen(function* overlappingIdentities() {
      const both = yield* Deferred.make<undefined>();
      const seen: string[] = [];

      const host = yield* startHost({
        beforeAuthorize: (identity) =>
          Effect.gen(function* authorizeIdentity() {
            seen.push(identity);

            if (seen.length === 2) {
              yield* Deferred.succeed(both, undefined);
            }

            yield* Deferred.await(both);
          }),
      });

      yield* Effect.all([call(host, "alice"), call(host, "bob")], { concurrency: "unbounded" });
      expect(seen.toSorted()).toStrictEqual(["alice", "bob"]);
      expect(host.resumedIdentities.toSorted()).toStrictEqual(["alice", "bob"]);
      expect(
        host.events.filter((event) => event.startsWith("finalized:")).toSorted(),
      ).toStrictEqual(["finalized:alice", "finalized:bob"]);
      expect(host.traces.map((trace) => trace.identity).toSorted()).toStrictEqual(["alice", "bob"]);
      expect(new Set(host.traces.map((trace) => trace.host)).size).toBe(2);
    }),
  );

  it.live("client abort interrupts pending work and awaits request finalization", () =>
    Effect.gen(function* clientAbort() {
      const entered = yield* Deferred.make<undefined>();
      const finalized = yield* Deferred.make<undefined>();

      const host = yield* startHost({
        beforeAuthorize: () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        onFinalized: () => Deferred.succeed(finalized, undefined).pipe(Effect.asVoid),
      });

      // oxlint-disable-next-line effecttsgo/abort-controller-in-effect -- Exercise an external client AbortSignal.
      // @effect-diagnostics-next-line abortControllerInEffect:off
      const controller = new AbortController();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          controller.abort();
        }),
      );
      const pending = yield* Effect.forkChild(Effect.exit(call(host, "alice", controller.signal)));
      yield* bounded(Deferred.await(entered));
      controller.abort();
      yield* bounded(Deferred.await(finalized));
      yield* bounded(Fiber.join(pending));
      expect(host.events).toStrictEqual(["entered:alice", "finalized:alice"]);
    }),
  );

  it.live("abort joins the oRPC runner before closing its request scope", () =>
    Effect.gen(function* joinRunner() {
      const entered = yield* Deferred.make<undefined>();
      const cleaning = yield* Deferred.make<undefined>();
      const release = yield* Deferred.make<undefined>();
      const finalized = yield* Deferred.make<undefined>();

      const host = yield* startHost({
        beforeAuthorize: () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        onRunnerFinalize: () =>
          Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release))),
        onFinalized: () => Deferred.succeed(finalized, undefined).pipe(Effect.asVoid),
      });

      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
      // oxlint-disable-next-line effecttsgo/abort-controller-in-effect -- Exercise an external client AbortSignal.
      // @effect-diagnostics-next-line abortControllerInEffect:off
      const controller = new AbortController();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          controller.abort();
        }),
      );
      const pending = yield* Effect.forkChild(Effect.exit(call(host, "alice", controller.signal)));
      yield* bounded(Deferred.await(entered));
      controller.abort();
      yield* bounded(Deferred.await(cleaning));
      expect(host.events).toStrictEqual(["entered:alice"]);
      yield* Deferred.succeed(release, undefined);
      yield* bounded(Deferred.await(finalized));
      yield* bounded(Fiber.join(pending));
      expect(host.events).toStrictEqual(["entered:alice", "finalized:alice"]);
    }),
  );

  it.live("shutdown joins active request cleanup before shared release", () =>
    Effect.gen(function* shutdownRequest() {
      const entered = yield* Deferred.make<undefined>();
      const cleaning = yield* Deferred.make<undefined>();
      const release = yield* Deferred.make<undefined>();

      const host = yield* startHost({
        beforeAuthorize: () =>
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        onFinalize: () =>
          Deferred.succeed(cleaning, undefined).pipe(Effect.andThen(Deferred.await(release))),
      });

      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
      const pending = yield* Effect.forkChild(Effect.exit(call(host, "alice")));
      yield* bounded(Deferred.await(entered));
      const closing = yield* Effect.forkChild(host.close);
      yield* bounded(Deferred.await(cleaning));
      expect(host.events).not.toContain("shared-released");
      yield* Deferred.succeed(release, undefined);
      yield* bounded(Fiber.join(closing));
      yield* bounded(Fiber.join(pending));
      expect(host.events).toStrictEqual(["entered:alice", "finalized:alice", "shared-released"]);
      expect(
        yield* Effect.flip(
          Effect.tryPromise(async () => await fetch(`${host.url}/api/v1/processing`)),
        ),
      ).toBeDefined();
    }),
  );
});

it.live("startup failure releases already acquired shared resources", () =>
  Effect.gen(function* startupFailure() {
    const running = yield* startHost();
    let released = false;

    const failure = yield* Effect.flip(
      startHost({
        port: Number(new URL(running.url).port),
        onRelease: () => {
          released = true;
        },
      }),
    );

    expect(failure).toBeDefined();
    expect(released).toBe(true);
  }),
);
