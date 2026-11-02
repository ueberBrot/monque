import type { Scope } from "effect";
import { Cause, Deferred, Duration, Effect, Exit, Option, Semaphore } from "effect";
import { forEach as forEachEffect } from "effect/Effect";
import type { Collection } from "mongodb";

import type { MonqueEventMap } from "@/events";
import { JobStatus } from "@/jobs";
import type { PersistedJob } from "@/jobs";
import { PayloadValidationError, toError } from "@/shared";
import type { WorkerRegistration } from "@/workers";

import { attempt, fromPromise, observeBackgroundFailure } from "../effects.js";
import { JobDiscovery } from "./job-discovery.js";
import type { JobOwnership } from "./job-ownership.js";
import { JobPersistenceError } from "./job-persistence-error.js";
import { makeOperationTelemetry } from "./operation-telemetry.js";
import type { ResolvedMonqueOptions } from "./types.js";
import type { WorkerAdmission } from "./worker-admission.js";

const MAX_REPOLL_TARGET_NAMES = 1024;

const validatePayload = Effect.fnUntraced(function* validatePayload(
  job: PersistedJob,
  schema: NonNullable<WorkerRegistration["schema"]>,
) {
  const result = yield* fromPromise(async () => await schema["~standard"].validate(job.data));

  if (result.issues) {
    return yield* Effect.fail(new PayloadValidationError(job.name, result.issues));
  }

  return result.value;
});

interface ProcessingState {
  repollRequested: boolean;
  repollIsCurrent: () => boolean;
  repollTargetNames: Set<string> | undefined;
}

export interface ExecutionDependencies {
  readonly collection: Collection;
  readonly emit: <K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]) => boolean;
  readonly notifyPendingJob: (name: string | undefined, nextRunAt: Date) => void;
  readonly notifyJobFinished: (name: string) => void;
  readonly options: Pick<ResolvedMonqueOptions, "instanceConcurrency">;
}

/** A stop captures its original admission identities before any asynchronous wait. */
export interface ExecutionDrain {
  readonly incompleteJobs: () => PersistedJob[];
  readonly await: (timeout: number) => Effect.Effect<boolean>;
}

/**
 * Instance-owned execution supervisor. Admission alone owns execution records and
 * capacity. Each fork is owned by the initialized scope, never by notifications
 * or a processing generation. Its uninterruptible Promise boundary lets external
 * work settle and record its fenced outcome before releasing admission.
 */
export class JobProcessor {
  private readonly polling = Semaphore.makeUnsafe(1);
  private readonly state: ProcessingState = {
    repollRequested: false,
    repollIsCurrent: () => true,
    repollTargetNames: undefined,
  };
  private readonly discovery: JobDiscovery;
  private readonly drainChecks = new Set<() => void>();
  private readonly ctx: ExecutionDependencies;
  private readonly ownership: JobOwnership["Service"];
  private readonly admission: WorkerAdmission["Service"];
  private readonly executionScope: Scope.Scope;
  private readonly telemetry: ReturnType<typeof makeOperationTelemetry>;
  constructor(
    ctx: ExecutionDependencies,
    ownership: JobOwnership["Service"],
    admission: WorkerAdmission["Service"],
    executionScope: Scope.Scope,
    telemetry = makeOperationTelemetry(),
  ) {
    this.telemetry = telemetry;
    this.ctx = ctx;
    this.ownership = ownership;
    this.admission = admission;
    this.executionScope = executionScope;
    this.discovery = new JobDiscovery(ctx);
  }
  captureDrain(): ExecutionDrain {
    const jobs = new Set(this.admission.activeJobs());
    const incompleteJobs = () => this.admission.activeJobs().filter((job) => jobs.has(job));

    const { drainChecks } = this;

    return {
      incompleteJobs,
      await: Effect.fnUntraced(function* awaitExecutionSnapshot(timeout: number) {
        const drain = yield* Deferred.make<Effect.Success<typeof Effect.void>>();

        const check = () => {
          if (incompleteJobs().length === 0) {
            Deferred.doneUnsafe(drain, Effect.void);
          }
        };

        drainChecks.add(check);
        check();

        const result = yield* Deferred.await(drain).pipe(
          Effect.timeoutOption(timeout),
          Effect.ensuring(Effect.sync(() => drainChecks.delete(check))),
        );

        return Option.isSome(result);
      }),
    };
  }
  readonly poll = (
    targetNames?: ReadonlySet<string>,
    isCurrent: () => boolean = () => this.admission.running,
  ): Effect.Effect<void, unknown> =>
    Effect.uninterruptibleMask((restore) => this.pollRegistered(targetNames, isCurrent, restore));
  private readonly pollRegistered = Effect.fnUntraced(function* pollRegisteredWorkers(
    this: JobProcessor,
    targetNames: ReadonlySet<string> | undefined,
    isCurrent: () => boolean,
    restore: Parameters<Parameters<typeof Effect.uninterruptibleMask>[0]>[0],
  ): Effect.fn.Return<void, unknown> {
    if (!isCurrent() || !this.admission.running || this.admission.isPaused()) {
      return;
    }

    if (!(yield* this.polling.takeIfAvailable(1))) {
      let names = targetNames ? this.state.repollTargetNames : undefined;

      if (names && targetNames) {
        for (const name of targetNames) {
          if (names.size === MAX_REPOLL_TARGET_NAMES && !names.has(name)) {
            names = undefined;
            break;
          }

          names.add(name);
        }
      }

      this.state.repollIsCurrent = isCurrent;
      this.state.repollRequested = true;
      this.state.repollTargetNames = names;

      return;
    }

    let requestedNames = targetNames;
    let currentRun = isCurrent;
    yield* restore(
      Effect.gen({ self: this }, function* runSerializedPoll() {
        do {
          this.state.repollRequested = false;
          this.state.repollTargetNames = new Set<string>();

          if (currentRun()) {
            yield* this.doPoll(requestedNames, currentRun);
          }

          requestedNames = this.state.repollTargetNames;
          currentRun = this.state.repollIsCurrent;
        } while (
          this.state.repollRequested &&
          currentRun() &&
          this.admission.running &&
          !this.admission.isPaused()
        );
      }),
    ).pipe(
      Effect.onExit((exit) =>
        Effect.gen({ self: this }, function* finishPoll() {
          yield* this.polling.release(1);

          // The interrupted notification generation cannot own a newer request.
          // Transfer only its coalesced successor, retaining that run's predicate.
          if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
            const pending = this.state.repollRequested;
            const nextNames = pending ? this.state.repollTargetNames : requestedNames;
            const nextCurrent = pending ? this.state.repollIsCurrent : currentRun;
            this.state.repollRequested = false;

            if ((pending || nextCurrent !== isCurrent) && nextCurrent()) {
              const fiber = yield* Effect.forkIn(
                this.poll(nextNames, nextCurrent),
                this.executionScope,
                { startImmediately: true, uninterruptible: false },
              );

              observeBackgroundFailure(fiber);
            }
          }
        }),
      ),
    );
  });
  private readonly doPoll = Effect.fnUntraced(function* claimAvailableJobs(
    this: JobProcessor,
    targetNames: ReadonlySet<string> | undefined,
    isCurrent: () => boolean,
  ): Effect.fn.Return<void, unknown> {
    const { instanceConcurrency } = this.ctx.options;

    const canClaim = () =>
      isCurrent() && this.admission.running && this.executionScope.state._tag !== "Closed";

    const names = this.admission.orderedNames();
    const requestedNames = instanceConcurrency === undefined ? targetNames : undefined;

    const eligibleNames = new Set(
      names.filter((name) => {
        const worker = this.admission.workers.get(name);

        return (
          worker !== undefined &&
          !this.admission.isPaused(name) &&
          worker.activeJobs.size < worker.concurrency
        );
      }),
    );

    if (eligibleNames.size === 0) {
      return;
    }

    // Discovery is generation-interruptible; native Claim writes below must
    // settle through dispatch or fenced release before interruption is observed.
    const dueNames = yield* this.discovery.discoverDue(eligibleNames, requestedNames, isCurrent);

    // oxlint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Guard clauses skip unavailable workers before claiming their slots.
    for (const name of names) {
      const worker = this.admission.workers.get(name);

      if (
        !worker ||
        this.admission.isPaused(name) ||
        !dueNames.has(name) ||
        worker.activeJobs.size >= worker.concurrency
      ) {
        continue;
      }

      const availableSlots = this.admission.availableSlots(name);

      if (availableSlots <= 0 || !canClaim()) {
        return;
      }

      let remaining = availableSlots;

      // oxlint-disable-next-line sonarjs/misplaced-loop-counter -- Batch size doubles independently while successful claims consume remaining slots.
      for (let batchSize = 1; remaining > 0 && canClaim(); batchSize *= 2) {
        const size = Math.min(batchSize, remaining);
        let found = 0;
        let acquisitionFailed = false;
        yield* forEachEffect(
          Array.from({ length: size }),
          () =>
            Effect.suspend(() =>
              canClaim() && !this.admission.isPaused(name)
                ? this.ownership.claimNext(name).pipe(Effect.mapError((failure) => failure.cause))
                : Effect.succeed(null),
            ).pipe(
              Effect.flatMap((job) => {
                if (!job) {
                  return Effect.void;
                }

                found += 1;
                this.admission.noteClaim(name);

                return this.dispatchClaim(job, worker, name, isCurrent);
              }),
              (body) => this.telemetry.observe("dispatch", body),
              Effect.catchCause((cause) =>
                attempt(() => {
                  acquisitionFailed = true;
                  this.ctx.emit("job:error", { error: toError(Cause.squash(cause)) });
                }),
              ),
              Effect.exit,
            ),
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.uninterruptible);

        if (found < size) {
          if (!acquisitionFailed && canClaim() && !this.admission.isPaused(name)) {
            yield* this.discovery.notifyNextRun(name, isCurrent);
          }

          break;
        }

        remaining -= size;
      }
    }
  });
  private readonly dispatchClaim = Effect.fnUntraced(function* dispatchClaimedJob(
    this: JobProcessor,
    job: PersistedJob,
    worker: WorkerRegistration,
    name: string,
    isCurrent: () => boolean,
  ): Effect.fn.Return<void, unknown> {
    if (
      !isCurrent() ||
      !this.admission.running ||
      this.admission.isPaused(name) ||
      this.executionScope.state._tag === "Closed"
    ) {
      yield* this.ownership.releaseOwnedClaim(job).pipe(
        Effect.mapError((failure) => failure.cause),
        Effect.catchCause((cause) =>
          attempt(() => {
            if (this.admission.running) {
              this.ctx.emit("job:error", { error: toError(Cause.squash(cause)), job });
            }
          }),
        ),
      );

      return;
    }

    const finishExecution = this.admission.beginExecution(name, job);

    const fiber = yield* Effect.forkIn(
      this.processJob(job, worker, finishExecution).pipe(
        Effect.catchCause((cause) =>
          attempt(() => {
            this.ctx.emit("job:error", { error: toError(Cause.squash(cause)), job });
          }),
        ),
      ),
      this.executionScope,
      { startImmediately: true, uninterruptible: true },
    );

    observeBackgroundFailure(fiber);
  });
  private notifyTransition(job: PersistedJob): Effect.Effect<void, unknown> {
    return job.status === JobStatus.PENDING
      ? attempt(() => {
          this.ctx.notifyPendingJob(job.name, job.nextRunAt);
        })
      : Effect.void;
  }
  private processJob(
    job: PersistedJob,
    worker: WorkerRegistration,
    finishExecution: () => void,
  ): Effect.Effect<void, unknown> {
    return Effect.gen({ self: this }, function* executeClaimedJob() {
      const [duration] = yield* Effect.gen({ self: this }, function* measureWorkerExecution() {
        yield* attempt(() => this.ctx.emit("job:start", job));
        let handlerJob = job;
        const { schema } = worker;

        if (schema !== undefined) {
          const validated = yield* this.telemetry.observe(
            "validation",
            validatePayload(job, schema),
          );

          handlerJob = { ...job, data: validated };
        }

        yield* this.telemetry.observe(
          "worker",
          fromPromise(async () => {
            await worker.handler(handlerJob);
          }),
        );

        return yield* Effect.void;
      }).pipe(Effect.timed);

      const updatedJob = yield* this.ownership
        .completeOwned(job)
        .pipe(
          Effect.mapError((failure) =>
            failure instanceof JobPersistenceError ? failure.cause : failure,
          ),
        );

      if (updatedJob) {
        yield* this.notifyTransition(updatedJob);
        yield* attempt(() =>
          this.ctx.emit("job:complete", { job: updatedJob, duration: Duration.toMillis(duration) }),
        );
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen({ self: this }, function* handleWorkerFailure() {
          const error = toError(Cause.squash(cause));

          const updatedJob = yield* this.ownership
            .failOwned(job, error, worker.retryOptions)
            .pipe(Effect.mapError((failure) => failure.cause));

          if (updatedJob) {
            yield* this.notifyTransition(updatedJob);
            yield* attempt(() =>
              this.ctx.emit("job:fail", {
                job: updatedJob,
                error,
                willRetry: updatedJob.status === JobStatus.PENDING,
              }),
            );
          }
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          finishExecution();
          this.ctx.notifyJobFinished(job.name);

          for (const check of this.drainChecks) {
            check();
          }
        }),
      ),
      (body) => this.telemetry.observe("execution", body),
    );
  }
}
