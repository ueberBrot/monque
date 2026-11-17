import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";
/* oxlint-disable typescript/no-invalid-void-type -- Native Promise.withResolvers<void> gates model lifecycle completion without values. */
import { Effect } from "effect";

import { startHost } from "./host";

const bounded = async function bounded<A>(promise: Promise<A>): Promise<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      // oxlint-disable-next-line promise/avoid-new -- A native timer bounds real I/O lifecycle completion.
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Lifecycle gate exceeded 2 seconds"));
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const rejection = async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }

    throw new Error("Unexpected non-Error rejection", { cause: error });
  }

  throw new Error("Expected request rejection");
};

test("RPC reaches native processing state with the existing HTTP DTO", async () => {
  const host = await startHost();

  try {
    expect(await host.client("alice").processingState()).toEqual({
      instanceId: "proof-686",
      paused: false,
      globallyPaused: false,
    });
  } finally {
    await host.close();
  }
});

describe.each(["rpc", "http"] as const)("%s", (transport) => {
  const call = async (
    host: Awaited<ReturnType<typeof startHost>>,
    identity: string,
    signal?: AbortSignal,
  ) => {
    if (transport === "rpc") {
      return await host.client(identity).processingState(undefined, { signal });
    }

    const response = await fetch(`${host.url}/api/v1/processing`, {
      headers: { "x-identity": identity },
      signal: signal ?? null,
    });

    const body: unknown = await response.json();

    return { status: response.status, body };
  };

  test(`${transport}: native result, denial envelope, request finalizers and tracing`, async () => {
    const host = await startHost();

    try {
      const result = await call(host, "alice");
      const dto = { instanceId: "proof-686", paused: false, globallyPaused: false };
      expect(result).toEqual(transport === "rpc" ? dto : { status: 200, body: dto });

      if (transport === "rpc") {
        expect(await rejection(call(host, "denied"))).toMatchObject({
          code: "FORBIDDEN",
          message: "Denied",
        });
      } else {
        expect(await call(host, "denied")).toEqual({ status: 403, body: { error: "Denied" } });
      }

      expect(host.events).toEqual([
        "entered:alice",
        "finalized:alice",
        "entered:denied",
        "finalized:denied",
      ]);

      for (const trace of host.traces) {
        expect(trace.parent).toBe(trace.host);
        expect(trace.trace).toBe(trace.hostTrace);
      }
    } finally {
      await host.close();
    }
  });

  test.each([
    new Error("private defect"),
    new ORPCError("FORBIDDEN", { message: "private defect" }),
  ])(
    `${transport}: defects remain internal failures and release request resources (%s)`,
    async (defect) => {
      const host = await startHost({
        beforeAuthorize: () => Effect.die(defect),
      });

      try {
        if (transport === "rpc") {
          expect(await rejection(call(host, "alice"))).toMatchObject({
            code: "INTERNAL_SERVER_ERROR",
            message: "Internal Server Error",
          });
        } else {
          expect(await call(host, "alice")).toEqual({
            status: 500,
            body: { error: "Internal server error" },
          });
        }

        expect(host.events).toEqual(["entered:alice", "finalized:alice"]);
      } finally {
        await host.close();
      }
    },
  );

  test(`${transport}: overlapping requests retain distinct host identities`, async () => {
    const both = Promise.withResolvers<void>();
    const seen: string[] = [];

    const host = await startHost({
      beforeAuthorize: (identity) =>
        Effect.gen(function* beforeAuthorize() {
          seen.push(identity);

          if (seen.length === 2) {
            both.resolve();
          }

          yield* Effect.promise(async () => {
            await both.promise;
          });
        }),
    });

    try {
      await Promise.all([call(host, "alice"), call(host, "bob")]);
      expect(seen.toSorted()).toEqual(["alice", "bob"]);
      expect(host.resumedIdentities.toSorted()).toEqual(["alice", "bob"]);
      expect(host.events.filter((e) => e.startsWith("finalized:")).toSorted()).toEqual([
        "finalized:alice",
        "finalized:bob",
      ]);
      expect(host.traces.map((t) => t.identity).toSorted()).toEqual(["alice", "bob"]);
      expect(new Set(host.traces.map((t) => t.host)).size).toBe(2);
    } finally {
      both.resolve();
      await host.close();
    }
  });

  test(`${transport}: client abort interrupts pending work and awaits request finalization`, async () => {
    const entered = Promise.withResolvers<void>();
    const finalized = Promise.withResolvers<void>();

    const host = await startHost({
      beforeAuthorize: () =>
        Effect.sync(() => {
          entered.resolve();
        }).pipe(Effect.andThen(Effect.never)),
      onFinalize: () =>
        Effect.sync(() => {
          finalized.resolve();
        }),
    });

    const controller = new AbortController();

    try {
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Handle rejection before aborting the pending request.
      const pending = call(host, "alice", controller.signal).catch(() => null);
      await bounded(entered.promise);
      controller.abort();
      await bounded(finalized.promise);
      await bounded(pending);
      expect(host.events).toEqual(["entered:alice", "finalized:alice"]);
    } finally {
      controller.abort();
      await host.close();
    }
  });

  test(`${transport}: abort joins the oRPC runner before closing its request scope`, async () => {
    const entered = Promise.withResolvers<void>();
    const cleaning = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const finalized = Promise.withResolvers<void>();

    const host = await startHost({
      beforeAuthorize: () =>
        Effect.sync(() => {
          entered.resolve();
        }).pipe(Effect.andThen(Effect.never)),
      onRunnerFinalize: () =>
        Effect.sync(() => {
          cleaning.resolve();
        }).pipe(
          Effect.andThen(
            Effect.promise(async () => {
              await release.promise;
            }),
          ),
        ),
      onFinalize: () =>
        Effect.sync(() => {
          finalized.resolve();
        }),
    });

    const controller = new AbortController();
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Handle rejection before aborting the pending request.
    const pending = call(host, "alice", controller.signal).catch(() => null);

    try {
      await bounded(entered.promise);
      controller.abort();
      await bounded(cleaning.promise);
      expect(host.events).toEqual(["entered:alice"]);
      release.resolve();
      await bounded(finalized.promise);
      await bounded(pending);
      expect(host.events).toEqual(["entered:alice", "finalized:alice"]);
    } finally {
      release.resolve();
      controller.abort();
      await host.close();
    }
  });

  test(`${transport}: shutdown joins active request cleanup before shared release`, async () => {
    const entered = Promise.withResolvers<void>();
    const cleaning = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const host = await startHost({
      beforeAuthorize: () =>
        Effect.sync(() => {
          entered.resolve();
        }).pipe(Effect.andThen(Effect.never)),
      onFinalize: () =>
        Effect.sync(() => {
          cleaning.resolve();
        }).pipe(
          Effect.andThen(
            Effect.promise(async () => {
              await release.promise;
            }),
          ),
        ),
    });

    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Handle rejection before aborting the pending request.
    const pending = call(host, "alice").catch(() => null);

    try {
      await bounded(entered.promise);
      const closing = host.close();
      await bounded(cleaning.promise);
      expect(host.events).not.toContain("shared-released");
      release.resolve();
      await bounded(closing);
      await bounded(pending);
      expect(host.events).toEqual(["entered:alice", "finalized:alice", "shared-released"]);
      expect(await rejection(fetch(`${host.url}/api/v1/processing`))).toBeInstanceOf(Error);
    } finally {
      release.resolve();
      await host.close();
    }
  });
});

test("startup failure releases already acquired shared resources", async () => {
  const running = await startHost();
  let released = false;

  try {
    expect(
      await rejection(
        startHost({
          port: Number(new URL(running.url).port),
          onRelease: () => {
            released = true;
          },
        }),
      ),
    ).toBeDefined();
    expect(released).toBe(true);
  } finally {
    await running.close();
  }
});
