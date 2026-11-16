import { Data, Effect } from "effect";
import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { JobStatus, Monque, MonqueEffect, NonRetryableError } from "@/index.js";
import { cleanupTestDb, getTestDb, uniqueCollectionName, waitFor } from "@test-utils/test-utils.js";

class MailFailure extends Data.TaggedError("MailFailure") {}

describe("ordinary and native Effect consumers", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getTestDb("effect-consumer");
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it.each(["ordinary", "effect"] as const)(
    "shares intake, management and reads (%s)",
    async (consumer) => {
      const monque = new Monque(db, { collectionName: uniqueCollectionName("consumer") });
      await monque.initialize();

      try {
        const run =
          consumer === "ordinary"
            ? monque
            : {
                enqueue: async (name: string, data: { subject: string }) =>
                  await Effect.runPromise(monque.effects.enqueue(name, data)),
                getJob: async (id: string) => await Effect.runPromise(monque.effects.getJob(id)),
                cancelJob: async (id: string) =>
                  await Effect.runPromise(monque.effects.cancelJob(id)),
                retryJob: async (id: string) =>
                  await Effect.runPromise(monque.effects.retryJob(id)),
              };

        const job = await run.enqueue("mail", { subject: "Hello" });
        await expect(run.getJob(job._id.toHexString())).resolves.toMatchObject({
          status: JobStatus.PENDING,
        });
        await expect(run.cancelJob(job._id.toHexString())).resolves.toMatchObject({
          status: JobStatus.CANCELLED,
        });
        await expect(run.retryJob(job._id.toHexString())).resolves.toMatchObject({
          status: JobStatus.PENDING,
        });
      } finally {
        await monque.dispose();
      }
    },
  );

  it.each(["typed", "defect", "interrupt", "terminal"] as const)(
    "persists native Worker failure and finalizes (%s)",
    async (outcome) => {
      let finalized = 0;
      await Effect.runPromise(
        Effect.gen(function* workerOutcome() {
          const scheduler = yield* MonqueEffect;

          const failures = {
            typed: Effect.fail(new MailFailure()),
            defect: Effect.die(new Error("defect")),
            interrupt: Effect.interrupt,
            terminal: Effect.fail<unknown>(new NonRetryableError("terminal")),
          };

          const failure = failures[outcome];
          yield* scheduler.register("mail", () =>
            failure.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  finalized += 1;
                }),
              ),
            ),
          );
          const job = yield* scheduler.now("mail", {});
          yield* scheduler.start;
          const run = Effect.runPromiseWith(yield* Effect.context());
          yield* Effect.promise(async () => {
            await waitFor(async () => {
              const current = await run(scheduler.getJob(job._id));

              return current?.failCount === 1;
            });
          });
          yield* scheduler.stop;
          expect(yield* scheduler.getJob(job._id)).toMatchObject({
            status: outcome === "terminal" ? JobStatus.FAILED : JobStatus.PENDING,
            failCount: 1,
          });
          expect(finalized).toBe(1);
        }).pipe(
          Effect.provide(
            MonqueEffect.layer(db, {
              collectionName: uniqueCollectionName("worker"),
              pollInterval: 10,
              baseRetryInterval: 60_000,
            }),
          ),
        ),
      );
      await expect(db.command({ ping: 1 })).resolves.toMatchObject({ ok: 1 });
    },
  );
});

describe("native scope shutdown", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getTestDb("effect-shutdown");
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("interrupts a native Worker after drain timeout and runs its finalizer", async () => {
    const started = Promise.withResolvers<undefined>();
    let finalized = false;
    const collectionName = uniqueCollectionName("shutdown");

    const job = await Effect.runPromise(
      Effect.gen(function* scopeShutdown() {
        const scheduler = yield* MonqueEffect;
        yield* scheduler.register("work", () =>
          Effect.sync(() => {
            started.resolve(undefined);
          }).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => {
                finalized = true;
              }),
            ),
          ),
        );
        const pending = yield* scheduler.now("work", {});
        yield* scheduler.start;
        yield* Effect.promise(async () => {
          await started.promise;
        });

        return pending;
      }).pipe(
        Effect.provide(
          MonqueEffect.layer(db, { collectionName, shutdownTimeout: 10, pollInterval: 10 }),
        ),
      ),
    );

    expect(finalized).toBe(true);
    const observer = new Monque(db, { collectionName });
    await observer.initialize();

    try {
      await expect(observer.getJob(job._id)).resolves.toMatchObject({
        status: JobStatus.PENDING,
        failCount: 1,
      });
    } finally {
      await observer.dispose();
    }
  });
});
