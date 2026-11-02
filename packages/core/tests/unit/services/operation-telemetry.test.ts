import { it as effectIt } from "@effect/vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Metric,
  Scope,
  Tracer,
} from "effect";
import { TestClock } from "effect/testing";
import type { ClientSession } from "mongodb";
import { MongoServerError, ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vite-plus/test";

import { makeSchedulerLayer } from "@/scheduler/runtime.js";
import { JobExecution } from "@/scheduler/services/job-execution.js";
import { JobIntake } from "@/scheduler/services/job-intake.js";
import { JobOwnership } from "@/scheduler/services/job-ownership.js";
import { JobPersistenceError } from "@/scheduler/services/job-persistence-error.js";
import {
  OperationTelemetry,
  makeOperationTelemetryLayer,
  makeOperationTelemetry,
} from "@/scheduler/services/operation-telemetry.js";
import { createMockContext, JobFactoryHelpers } from "@tests/factories";
import { objectContainingMatcher } from "@tests/setup/matchers.js";

const record = () => {
  const spans: Tracer.NativeSpan[] = [];

  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);

      return span;
    },
  });

  return { spans, tracer };
};

const reportingClock = (
  clock: Clock.Clock,
  readings: Pick<Clock.Clock, "currentTimeNanosUnsafe" | "monotonicTimeNanosUnsafe">,
): Clock.Clock => ({
  currentTimeMillis: clock.currentTimeMillis,
  currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
  currentTimeNanos: clock.currentTimeNanos,
  currentTimeNanosUnsafe: readings.currentTimeNanosUnsafe,
  monotonicTimeNanos: clock.monotonicTimeNanos,
  monotonicTimeNanosUnsafe: readings.monotonicTimeNanosUnsafe,
  sleep: (duration) => clock.sleep(duration),
});

const snapshots = (registry: Metric.MetricRegistry) =>
  Metric.snapshot.pipe(Effect.provideService(Metric.MetricRegistry, registry));

const fixture = Effect.fnUntraced(function* telemetryFixture(
  ctx: ReturnType<typeof createMockContext> = createMockContext(),
) {
  ctx.options.recoverStaleJobs = false;
  const observer = record();
  const scope = yield* Scope.make();
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));

  const context = yield* makeSchedulerLayer(
    ctx,
    undefined,
    makeOperationTelemetryLayer.pipe(Layer.provide(Layer.succeed(Tracer.Tracer, observer.tracer))),
  ).pipe(Layer.buildWithScope(scope));

  return {
    ...observer,
    ctx,
    scope,
    registry: Context.get(context, Metric.MetricRegistry),
    execution: Context.get(context, JobExecution),
    intake: Context.get(context, JobIntake),
    ownership: Context.get(context, JobOwnership),
    telemetry: Context.get(context, OperationTelemetry),
  };
});

const prepareClaim = (ctx: ReturnType<typeof createMockContext>) => {
  ctx.mockCollection.aggregate.mockReturnValue(
    fromPartial({
      toArray: async () => await Promise.resolve([{ _id: "email", nextRunAt: new Date(0) }]),
      close: async () => {
        await Promise.resolve();
      },
    }),
  );
};

describe("operation telemetry", () => {
  effectIt.effect(
    "reporting faults preserve a successful body and its expected failure channel",
    () =>
      Effect.gen(function* reportingFaults() {
        const original = new Error("application");
        const value = { result: "original" };
        let calls = 0;

        const tracer = Tracer.make({
          span() {
            throw new Error("observer setup");
          },
        });

        const context = yield* makeOperationTelemetryLayer.pipe(
          Layer.provide(Layer.succeed(Tracer.Tracer, tracer)),
          Layer.build,
        );

        const telemetry = Context.get(context, OperationTelemetry);

        const body = Effect.sync(() => {
          calls += 1;

          return value;
        });

        const result = yield* telemetry.observe("worker", body);
        const failure = yield* telemetry.observe("worker", Effect.fail(original)).pipe(Effect.exit);
        expect({ calls, result }).toStrictEqual({ calls: 1, result: value });
        expect(result).toBe(value);
        expect(failure).toStrictEqual(Exit.fail(original));
        const registry = Context.get(context, Metric.MetricRegistry);
        expect(registry.size).toBeGreaterThan(0);
      }),
  );

  effectIt.effect("relates Claims and surviving Worker execution through the composed Layer", () =>
    Effect.gen(function* relatedExecution() {
      const spans: Tracer.NativeSpan[] = [];

      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);

          return span;
        },
      });

      const ctx = createMockContext();
      ctx.options.recoverStaleJobs = false;
      const started = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
      const release = Promise.withResolvers<Effect.Success<typeof Effect.void>>();
      ctx.admission.register("private-job-name", async () => {
        Deferred.doneUnsafe(started, Effect.void);
        await release.promise;
      });
      ctx.mockCollection.aggregate.mockReturnValue(
        fromPartial({
          toArray: async () =>
            await Promise.resolve([{ _id: "private-job-name", nextRunAt: new Date(0) }]),
          close: async () => {
            await Promise.resolve();
          },
        }),
      );
      ctx.mockCollection.findOneAndUpdate
        .mockResolvedValueOnce(JobFactoryHelpers.processing({ name: "private-job-name" }))
        .mockResolvedValue(null);
      const owner = yield* Scope.make();

      const context = yield* makeSchedulerLayer(
        ctx,
        undefined,
        makeOperationTelemetryLayer.pipe(Layer.provide(Layer.succeed(Tracer.Tracer, tracer))),
      ).pipe(Layer.buildWithScope(owner));

      const execution = Context.get(context, JobExecution);

      try {
        yield* execution.poll();
        yield* Deferred.await(started);
        const drain = execution.captureDrain();
        ctx.admission.stop();
        release.resolve();
        yield* drain.await(1000);
        yield* Scope.close(owner, Exit.void);
        const find = (name: string) => spans.find((span) => span.name === `monque.${name}`);
        const dispatch = find("dispatch");
        const claim = find("claim.acquire");
        const worker = find("worker");
        const parent = find("execution");
        expect(dispatch).toBeDefined();
        expect({ claim: claim?.parent, execution: parent?.parent }).toMatchObject({
          claim: { value: { spanId: dispatch?.spanId } },
          execution: { value: { spanId: dispatch?.spanId } },
        });
        expect(worker?.parent).toMatchObject({ value: { spanId: parent?.spanId } });
        expect(find("result.complete")?.traceId).toBe(dispatch?.traceId);
        expect(parent?.status).toMatchObject({ _tag: "Ended", exit: { _tag: "Success" } });
      } finally {
        release.resolve();
        yield* Scope.close(owner, Exit.void);
      }
    }),
  );

  effectIt.effect.each(["validation", "worker", "result.complete", "result.fail"] as const)(
    "records actual %s failure before orchestration recovery",
    (stage) =>
      Effect.gen(function* stageOutcomes() {
        const ctx = createMockContext();
        prepareClaim(ctx);
        const original = new MongoServerError({ message: "private failure", code: 91 });
        const job = JobFactoryHelpers.processing({ name: "email" });
        const failed = JobFactoryHelpers.failed({ name: "email" });
        ctx.admission.register(
          "email",
          () => {
            if (stage !== "result.complete") {
              throw original;
            }
          },
          stage === "validation"
            ? {
                concurrency: 1,
                schema: {
                  "~standard": {
                    version: 1,
                    vendor: "test",
                    validate: () => ({ issues: [{ message: "private input" }] }),
                  },
                },
              }
            : { concurrency: 1 },
        );
        ctx.mockCollection.findOneAndUpdate.mockResolvedValueOnce(job);

        if (stage === "result.complete") {
          ctx.mockCollection.findOneAndUpdate.mockRejectedValueOnce(original);
        }

        if (stage === "result.fail") {
          ctx.mockCollection.findOneAndUpdate.mockRejectedValueOnce(original);
        } else {
          ctx.mockCollection.findOneAndUpdate.mockResolvedValueOnce(failed);
        }

        const f = yield* fixture(ctx);
        yield* f.execution.poll();
        yield* Scope.close(f.scope, Exit.void);
        const selected = f.spans.find((span) => span.name === `monque.${stage}`);
        const outer = f.spans.find((span) => span.name === "monque.execution");
        expect(selected?.status).toMatchObject({ _tag: "Ended", exit: { _tag: "Failure" } });
        expect(outer?.status).toMatchObject({
          _tag: "Ended",
          exit: {
            _tag: stage === "result.fail" ? "Failure" : "Success",
          },
        });
        expect(selected?.parent).toMatchObject({ value: { spanId: outer?.spanId } });
        const metrics = yield* snapshots(f.registry);
        expect(metrics).toContainEqual(
          objectContainingMatcher({
            id: "monque.operations",
            attributes: { operation: stage, outcome: "failure" },
            state: { count: 1, incremental: true },
          }),
        );

        if (stage === "validation") {
          expect(f.spans.some((span) => span.name === "monque.worker")).toBe(false);
        } else if (stage !== "result.complete") {
          expect(ctx.emitHistory).toContainEqual(
            objectContainingMatcher({
              event: stage === "result.fail" ? "job:error" : "job:fail",
              payload: objectContainingMatcher({ error: original }),
            }),
          );
        }
      }),
  );

  effectIt.effect(
    "measures validation, Worker and persistence independently with monotonic time",
    () =>
      Effect.gen(function* stageTiming() {
        const ctx = createMockContext();
        prepareClaim(ctx);
        const validating = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const working = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const persisting = yield* Deferred.make<Effect.Success<typeof Effect.void>>();
        const validation = Promise.withResolvers<{ value: string }>();
        const worker = Promise.withResolvers<Effect.Success<typeof Effect.void>>();
        const completion = Promise.withResolvers<ReturnType<typeof JobFactoryHelpers.completed>>();
        ctx.admission.register(
          "email",
          async (job) => {
            expect(job.data).toBe("transformed");
            Deferred.doneUnsafe(working, Effect.void);
            await worker.promise;
          },
          {
            concurrency: 1,
            schema: {
              "~standard": {
                version: 1,
                vendor: "test",
                validate: async () => {
                  Deferred.doneUnsafe(validating, Effect.void);

                  return await validation.promise;
                },
              },
            },
          },
        );
        ctx.mockCollection.findOneAndUpdate
          .mockResolvedValueOnce(JobFactoryHelpers.processing({ name: "email" }))
          .mockImplementationOnce(async () => {
            Deferred.doneUnsafe(persisting, Effect.void);

            return await completion.promise;
          });
        const f = yield* fixture(ctx);
        const clock = yield* Clock.Clock;
        let wall = 1000n;

        try {
          yield* f.execution.poll().pipe(
            Effect.provideService(
              Clock.Clock,
              reportingClock(clock, {
                monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
                currentTimeNanosUnsafe: () => wall,
              }),
            ),
          );
          yield* Deferred.await(validating);
          yield* TestClock.adjust(10);
          wall = -1000n;
          validation.resolve({ value: "transformed" });
          yield* Deferred.await(working);
          yield* TestClock.adjust(20);
          worker.resolve();
          yield* Deferred.await(persisting);
          yield* TestClock.adjust(30);
          completion.resolve(JobFactoryHelpers.completed({ name: "email" }));
          yield* Scope.close(f.scope, Exit.void);
          const metrics = yield* snapshots(f.registry);
          const durations = metrics.filter((metric) => metric.id === "monque.operation.duration");

          for (const [operation, sum] of [
            ["validation", 10],
            ["worker", 20],
            ["result.complete", 30],
          ] as const) {
            expect(durations).toContainEqual(
              objectContainingMatcher({
                attributes: { operation, outcome: "success", time_unit: "milliseconds" },
                state: objectContainingMatcher({ count: 1, sum }),
              }),
            );
          }

          expect(ctx.emitHistory).toContainEqual(
            objectContainingMatcher({
              event: "job:complete",
              payload: objectContainingMatcher({ duration: 30 }),
            }),
          );
        } finally {
          validation.resolve({ value: "transformed" });
          worker.resolve();
          completion.resolve(JobFactoryHelpers.completed());
        }
      }),
  );

  effectIt.effect("isolates registries and discards ambient metric labels", () =>
    Effect.gen(function* boundedMeasurements() {
      const a = yield* fixture();
      const b = yield* fixture();
      a.ctx.mockCollection.insertOne.mockResolvedValue(fromPartial({ insertedId: new ObjectId() }));
      yield* a.intake.now("private-job-name", { password: "secret" }).pipe(
        Effect.provideService(Metric.CurrentMetricAttributes, {
          claimId: "private",
          payload: "secret",
        }),
      );
      expect(a.registry).not.toBe(b.registry);
      expect(yield* snapshots(b.registry)).toStrictEqual([]);
      const metrics = yield* snapshots(a.registry);
      expect(metrics).toContainEqual(
        objectContainingMatcher({
          id: "monque.operations",
          attributes: { operation: "intake.enqueue", outcome: "success" },
        }),
      );
      expect(
        metrics.every((metric) =>
          Object.keys(metric.attributes ?? {}).every((key) =>
            ["operation", "outcome", "time_unit"].includes(key),
          ),
        ),
      ).toBe(true);
      expect(a.spans.some((span) => span.name === "monque.intake.enqueue")).toBe(true);
    }),
  );

  effectIt.effect(
    "records empty and fenced transitions as success and recovery failures as typed failures",
    () =>
      Effect.gen(function* persistenceOutcomes() {
        const f = yield* fixture();
        f.ctx.mockCollection.findOneAndUpdate.mockResolvedValue(null);
        expect(yield* f.ownership.claimNext("private")).toBeNull();
        expect(yield* f.ownership.completeOwned(JobFactoryHelpers.processing())).toBeNull();
        const original = new Error("native recovery");
        f.ctx.mockCollection.updateMany
          .mockRejectedValueOnce(original)
          .mockResolvedValueOnce(fromPartial({ modifiedCount: 3 }));
        const failed = yield* f.ownership.recoverStaleJobs.pipe(Effect.exit);
        expect(failed).toStrictEqual(Exit.fail(new JobPersistenceError({ cause: original })));
        expect(yield* f.ownership.recoverStaleJobs).toBe(3);

        const outcomes = f.spans
          .filter((span) => span.name === "monque.recovery")
          .map((span) => (span.status._tag === "Ended" ? span.status.exit._tag : "Started"));

        expect(outcomes).toStrictEqual(["Failure", "Success"]);
      }),
  );

  effectIt.effect.each([
    "attribute",
    "event",
    "addLinks",
    "end",
    "identity",
    "metric",
    "metric.update",
  ] as const)(
    "contains throwing %s hooks without replaying bodies or electing typed errors to defects",
    (hook) =>
      Effect.gen(function* throwingHooks() {
        const observerFailure = new Error("reporter");
        const original = new JobPersistenceError({ cause: new Error("native") });
        const value = { original: true };
        const registry: Metric.MetricRegistry = new Map();

        const tracer = Tracer.make({
          span(options) {
            const span = new Tracer.NativeSpan(options);

            if (hook === "identity") {
              Object.defineProperty(span, "spanId", {
                get() {
                  throw observerFailure;
                },
              });
            } else if (hook !== "metric" && hook !== "metric.update") {
              span[hook] = () => {
                throw observerFailure;
              };
            }

            return span;
          },
          context() {
            throw observerFailure;
          },
        });

        if (hook === "metric") {
          vi.spyOn(registry, "get").mockImplementation(() => {
            throw observerFailure;
          });
        }

        const telemetry = makeOperationTelemetry(tracer, registry);

        if (hook === "metric.update") {
          yield* telemetry.observe("worker", Effect.void);
          yield* telemetry.observe("worker", Effect.fail(original)).pipe(Effect.exit);

          for (const metadata of registry.values()) {
            Object.defineProperty(metadata.hooks, "update", {
              value: () => {
                throw observerFailure;
              },
            });
          }
        }

        let bodies = 0;

        const body = Effect.gen(function* applicationBody() {
          bodies += 1;
          const span = yield* Effect.currentSpan;
          span.attribute("finite", true);
          span.event("finite", 0n);
          span.addLinks([]);

          return value;
        });

        const result = yield* telemetry.observe("worker", body);

        const failed = yield* telemetry
          .observe("worker", body.pipe(Effect.andThen(Effect.fail(original))))
          .pipe(Effect.exit);

        const recovered = yield* telemetry
          .observe("worker", Effect.fail(original))
          .pipe(Effect.catch((error) => Effect.succeed(error)));

        expect({ bodies, result, recovered }).toStrictEqual({
          bodies: 2,
          result: value,
          recovered: original,
        });
        expect(result).toBe(value);
        expect(failed).toStrictEqual(Exit.fail(original));
        expect(recovered).toBe(original);
      }),
  );

  effectIt.effect(
    "contains reporting setup and classification defects while preserving original Exits",
    () =>
      Effect.gen(function* reportingDefects() {
        const clock = yield* Clock.Clock;
        const original = new Error("application");
        const telemetry = makeOperationTelemetry();
        let bodies = 0;

        const result = yield* telemetry
          .observe(
            "worker",
            Effect.sync(() => {
              bodies += 1;

              return original;
            }),
          )
          .pipe(
            Effect.provideService(
              Clock.Clock,
              reportingClock(clock, {
                currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
                monotonicTimeNanosUnsafe: () => {
                  throw new Error("reporting clock");
                },
              }),
            ),
          );

        const cause = Cause.fail(original);

        const classify = vi.spyOn(cause.reasons, "every").mockImplementationOnce(() => {
          throw new Error("classification");
        });

        try {
          const failed = yield* telemetry
            .observe("worker", Effect.failCause(cause))
            .pipe(Effect.exit);

          expect(classify).toHaveBeenCalledOnce();
          expect(failed).toStrictEqual(Exit.fail(original));
          expect({ bodies, result }).toStrictEqual({ bodies: 1, result: original });
        } finally {
          classify.mockRestore();
        }
      }),
  );

  effectIt.effect("records interruption and failed elapsed time without changing either Exit", () =>
    Effect.gen(function* elapsedOutcomes() {
      const f = yield* fixture();
      const original = new Error("original");

      const failing = yield* f.telemetry
        .observe("worker", Effect.sleep(20).pipe(Effect.andThen(Effect.fail(original))))
        .pipe(Effect.forkChild);

      yield* TestClock.adjust(20);
      expect(yield* Fiber.await(failing)).toStrictEqual(Exit.fail(original));
      const waiting = yield* f.telemetry.observe("worker", Effect.never).pipe(Effect.forkChild);
      yield* TestClock.adjust(10);
      yield* Fiber.interrupt(waiting);
      const interrupted = yield* Fiber.await(waiting);
      expect(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
      const metrics = yield* snapshots(f.registry);
      expect(metrics).toContainEqual(
        objectContainingMatcher({
          id: "monque.operation.duration",
          attributes: { operation: "worker", outcome: "failure", time_unit: "milliseconds" },
          state: objectContainingMatcher({ count: 1, sum: 20 }),
        }),
      );
      expect(metrics).toContainEqual(
        objectContainingMatcher({
          id: "monque.operations",
          attributes: { operation: "worker", outcome: "interrupted" },
          state: objectContainingMatcher({ count: 1 }),
        }),
      );
    }),
  );

  effectIt.effect(
    "observes batch failure after Exit materialization and preserves transaction decisions under faulty reporting",
    () =>
      Effect.gen(function* intakeContracts() {
        const ctx = createMockContext();
        ctx.options.recoverStaleJobs = false;
        const observer = record();
        const registry: Metric.MetricRegistry = new Map();

        const faulty = Tracer.make({
          span(options) {
            const span = observer.tracer.span(options);
            span.end = () => {
              throw new Error("observer end");
            };

            return span;
          },
        });

        const context = yield* makeSchedulerLayer(
          ctx,
          undefined,
          Layer.mergeAll(
            Layer.succeed(OperationTelemetry, makeOperationTelemetry(faulty, registry)),
            Layer.succeed(Metric.MetricRegistry, registry),
          ),
        ).pipe(Layer.build);

        const intake = Context.get(context, JobIntake);
        const original = new MongoServerError({ message: "transaction", code: 91 });
        original.addErrorLabel("TransientTransactionError");
        const session = fromPartial<ClientSession>({ inTransaction: () => true });
        ctx.mockCollection.insertOne.mockRejectedValueOnce(original);
        const outcome = yield* intake.enqueue("email", {}, { session }).pipe(Effect.exit);
        expect(outcome).toStrictEqual(Exit.fail(new JobPersistenceError({ cause: original })));
        expect(ctx.mockCollection.insertOne).toHaveBeenCalledOnce();
        expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
        ctx.mockCollection.bulkWrite.mockRejectedValueOnce(original);
        yield* intake.enqueueMany([{ name: "email", data: {} }]).pipe(Effect.exit);
        const metrics = yield* snapshots(registry);
        expect(metrics).toContainEqual(
          objectContainingMatcher({
            id: "monque.operations",
            attributes: { operation: "intake.batch", outcome: "failure" },
          }),
        );
        expect(original.hasErrorLabel("TransientTransactionError")).toBe(true);
      }),
  );

  it("keeps application callback throws synchronous and reentrant under reporting faults", () => {
    const observer = new Error("observer");
    const application = new Error("callback");
    const events: string[] = [];

    const telemetry = makeOperationTelemetry(
      Tracer.make({
        span() {
          throw observer;
        },
      }),
    );

    const callback = () => {
      events.push("callback");
      expect(
        Effect.runSync(
          telemetry.observe(
            "worker",
            Effect.sync(() => events.push("reentry")),
          ),
        ),
      ).toBe(2);
      throw application;
    };

    const exit = Effect.runSyncExit(telemetry.observe("worker", Effect.sync(callback)));
    events.push("returned");
    expect(events).toStrictEqual(["callback", "reentry", "returned"]);
    expect(exit).toStrictEqual(Exit.die(application));
  });
});
