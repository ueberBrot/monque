import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import { JobStatus, type PersistedJob } from "@/jobs";
import { PayloadValidationError, toError } from "@/shared";
import type { WorkerRegistration } from "@/workers";

import { attempt, fromPromise, observeBackgroundFailure } from "../effects.js";
import { JobDiscovery } from "./job-discovery.js";
import { JobLifecycle } from "./job-lifecycle.js";
import type { SchedulerContext } from "./types.js";

const MAX_REPOLL_TARGET_NAMES = 1024;

interface ProcessingState {
  repollRequested: boolean;
  repollTargetNames: Set<string> | undefined;
  totalActiveJobs: number;
  lastServedWorker: string | undefined;
}

export class JobProcessor {
  private readonly polling = Semaphore.makeUnsafe(1);
  private readonly state: ProcessingState = {
    repollRequested: false,
    repollTargetNames: undefined,
    totalActiveJobs: 0,
    lastServedWorker: undefined,
  };
  private readonly discovery: JobDiscovery;

  constructor(
    private readonly ctx: SchedulerContext,
    private readonly lifecycle = new JobLifecycle(ctx),
  ) {
    this.discovery = new JobDiscovery(ctx);
  }

  readonly poll = Effect.fnUntraced(
    function* (
      this: JobProcessor,
      targetNames?: ReadonlySet<string>,
    ): Effect.fn.Return<void, unknown> {
      if (!this.ctx.isRunning() || this.ctx.isPaused()) return;

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
        this.state.repollRequested = true;
        this.state.repollTargetNames = names;
        return;
      }

      yield* Effect.gen({ self: this }, function* () {
        do {
          this.state.repollRequested = false;
          this.state.repollTargetNames = new Set<string>();
          yield* this.doPoll(targetNames);
          targetNames = this.state.repollTargetNames;
        } while (this.state.repollRequested && this.ctx.isRunning() && !this.ctx.isPaused());
      }).pipe(Effect.ensuring(this.polling.release(1)));
    },
    (effect: Effect.Effect<void, unknown>, _targetNames?: ReadonlySet<string>) =>
      Effect.uninterruptible(effect),
  );

  private readonly doPoll = Effect.fnUntraced(function* (
    this: JobProcessor,
    targetNames?: ReadonlySet<string>,
  ): Effect.fn.Return<void, unknown> {
    const { instanceConcurrency } = this.ctx.options;
    const state = this.state;
    if (instanceConcurrency !== undefined && state.totalActiveJobs >= instanceConcurrency) return;

    let names = [...this.ctx.workers.keys()];
    if (instanceConcurrency !== undefined) {
      const next = names.findIndex((name) => name === state.lastServedWorker) + 1;
      names = names.slice(next).concat(names.slice(0, next));
      targetNames = undefined;
    }

    const eligibleNames = new Set(
      names.filter((name) => {
        const worker = this.ctx.workers.get(name);
        return (
          worker !== undefined &&
          !this.ctx.isPaused(name) &&
          worker.activeJobs.size < worker.concurrency
        );
      }),
    );
    if (eligibleNames.size === 0) return;
    const dueNames = yield* this.discovery.discoverDue(eligibleNames, targetNames);

    for (const name of names) {
      const worker = this.ctx.workers.get(name);
      if (!worker || this.ctx.isPaused(name) || !dueNames.has(name)) continue;
      const workerAvailableSlots = worker.concurrency - worker.activeJobs.size;
      if (workerAvailableSlots <= 0) continue;
      const availableSlots =
        instanceConcurrency === undefined
          ? workerAvailableSlots
          : Math.min(workerAvailableSlots, instanceConcurrency - this.state.totalActiveJobs);
      if (availableSlots <= 0 || !this.ctx.isRunning()) return;

      let remaining = availableSlots;
      for (let batchSize = 1; remaining > 0 && this.ctx.isRunning(); batchSize *= 2) {
        const size = Math.min(batchSize, remaining);
        let found = 0;
        let acquisitionFailed = false;
        yield* Effect.forEach(
          Array.from({ length: size }),
          () =>
            this.lifecycle.claimNext(name).pipe(
              Effect.flatMap((job) => {
                if (!job) return Effect.void;
                found++;
                this.state.lastServedWorker = name;
                return this.dispatchClaim(job, worker, name);
              }),
              Effect.catchCause((cause) =>
                attempt(() => {
                  acquisitionFailed = true;
                  this.ctx.emit("job:error", { error: toError(Cause.squash(cause)) });
                }),
              ),
              Effect.exit,
            ),
          { concurrency: "unbounded", discard: true },
        );
        if (found < size) {
          if (!acquisitionFailed && this.ctx.isRunning() && !this.ctx.isPaused(name)) {
            yield* this.discovery.notifyNextRun(name);
          }
          break;
        }
        remaining -= size;
      }
    }
  });

  private readonly dispatchClaim = Effect.fnUntraced(function* (
    this: JobProcessor,
    job: PersistedJob,
    worker: WorkerRegistration,
    name: string,
  ): Effect.fn.Return<void, unknown> {
    if (!this.ctx.isRunning() || this.ctx.isPaused(name)) {
      yield* this.lifecycle.releaseOwnedClaim(job).pipe(
        Effect.catchCause((cause) =>
          attempt(() => {
            if (this.ctx.isRunning()) {
              this.ctx.emit("job:error", { error: toError(Cause.squash(cause)), job });
            }
          }),
        ),
      );
      return;
    }

    worker.activeJobs.set(job.claimId ?? job._id.toString(), job);
    this.state.totalActiveJobs++;
    const fiber = yield* Effect.forkDetach(
      this.processJob(job, worker).pipe(
        Effect.catchCause((cause) =>
          attempt(() => {
            this.ctx.emit("job:error", { error: toError(Cause.squash(cause)), job });
          }),
        ),
      ),
      { startImmediately: true, uninterruptible: true },
    );
    observeBackgroundFailure(fiber);
  });

  private processJob(job: PersistedJob, worker: WorkerRegistration): Effect.Effect<void, unknown> {
    const claimId = job.claimId ?? job._id.toString();
    return Effect.gen({ self: this }, function* () {
      const [duration] = yield* Effect.gen({ self: this }, function* () {
        yield* attempt(() => this.ctx.emit("job:start", job));
        let handlerJob = job;
        if (worker.schema) {
          const result = yield* fromPromise(() =>
            Promise.resolve(worker.schema!["~standard"].validate(job.data)),
          );
          if (result.issues)
            return yield* Effect.fail(new PayloadValidationError(job.name, result.issues));
          handlerJob = { ...job, data: result.value };
        }
        yield* fromPromise(() => Promise.resolve(worker.handler(handlerJob)));
      }).pipe(Effect.timed);
      const updatedJob = yield* this.lifecycle.completeOwned(job);
      if (updatedJob)
        yield* attempt(() =>
          this.ctx.emit("job:complete", { job: updatedJob, duration: Duration.toMillis(duration) }),
        );
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.gen({ self: this }, function* () {
          const error = toError(Cause.squash(cause));
          const updatedJob = yield* this.lifecycle.failOwned(job, error, worker.retryOptions);
          if (updatedJob) {
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
          worker.activeJobs.delete(claimId);
          this.state.totalActiveJobs--;
          this.ctx.notifyJobFinished(job.name);
        }),
      ),
    );
  }
}
