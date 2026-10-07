import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import {
  BSON,
  type BulkWriteResult,
  type Document,
  MongoBulkWriteError,
  MongoServerError,
  ObjectId,
} from "mongodb";

import {
  type EnqueueJob,
  type EnqueueManyResult,
  type EnqueueOptions,
  type Job,
  JobStatus,
  type JobWriteOptions,
  type NowOptions,
  type PersistedJob,
  type ScheduleOptions,
} from "@/jobs";
import {
  ConnectionError,
  getNextCronDate,
  PayloadTooLargeError,
  toError,
  validateJobName,
  validateUniqueKey,
} from "@/shared";

import { validateJobPriority } from "../../shared/utils/job-priority.js";
import { attempt, fromPromise } from "../effects.js";
import type { SchedulerContext } from "./types.js";

/**
 * Internal module for creating pending jobs.
 *
 * Keeps validation, initial job document construction, persistence, and local
 * pending-job notification in one place.
 *
 * @internal Not part of public API - use Monque class methods instead.
 */
export class JobIntake {
  constructor(private readonly ctx: SchedulerContext) {}

  private validateJobIdentifiers(name: string, uniqueKey?: string): void {
    validateJobName(name);

    if (uniqueKey !== undefined) {
      validateUniqueKey(uniqueKey);
    }
  }

  private validatePayloadSize(data: unknown): void {
    const maxSize = this.ctx.options.maxPayloadSize;
    if (maxSize === undefined) {
      return;
    }

    let size: number;
    try {
      size = BSON.calculateObjectSize({ data } as Document);
    } catch (error) {
      const cause = toError(error);
      const sizeError = new PayloadTooLargeError(
        `Failed to calculate job payload size: ${cause.message}`,
        -1,
        maxSize,
      );
      sizeError.cause = cause;
      throw sizeError;
    }

    if (size > maxSize) {
      throw new PayloadTooLargeError(
        `Job payload exceeds maximum size: ${size} bytes > ${maxSize} bytes`,
        size,
        maxSize,
      );
    }
  }

  private persistPendingJob = Effect.fnUntraced(function* <T>(
    this: JobIntake,
    operation: "enqueue" | "schedule",
    job: Omit<Job<T>, "_id">,
    options: EnqueueOptions | ScheduleOptions,
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    return yield* Effect.gen({ self: this }, function* () {
      const { uniqueKey, session } = options;
      if (uniqueKey !== undefined) {
        const filter = {
          name: job.name,
          uniqueKey,
          status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
        };
        const result = yield* fromPromise(() =>
          this.ctx.collection.findOneAndUpdate(
            filter,
            { $setOnInsert: job },
            {
              upsert: true,
              returnDocument: "after",
              ...(session && { session }),
            },
          ),
        ).pipe(
          Effect.catch((error) =>
            Effect.gen({ self: this }, function* () {
              if (session?.inTransaction()) return yield* Effect.fail(error);
              if (!(error instanceof MongoServerError) || error.code !== 11000)
                return yield* Effect.fail(error);
              const pattern: unknown = error["keyPattern"];
              if (
                typeof pattern !== "object" ||
                pattern === null ||
                !("name" in pattern) ||
                pattern.name !== 1 ||
                !("uniqueKey" in pattern) ||
                pattern.uniqueKey !== 1 ||
                Object.keys(pattern).length !== 2
              )
                return yield* Effect.fail(error);
              const existing = yield* fromPromise(() =>
                this.ctx.collection.findOne(filter, {
                  readPreference: "primary",
                  ...(session && { session }),
                }),
              );
              if (!existing) return yield* Effect.fail(error);
              return existing;
            }),
          ),
        );

        if (!result) {
          return yield* Effect.fail(
            new ConnectionError(
              `Failed to ${operation} job: findOneAndUpdate returned no document`,
            ),
          );
        }

        const persistedJob = yield* attempt(() => this.ctx.documentToPersistedJob<T>(result));
        if (persistedJob.status === JobStatus.PENDING && !session?.inTransaction()) {
          yield* attempt(() =>
            this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt),
          );
        }
        return persistedJob;
      }

      const result = yield* fromPromise(() =>
        this.ctx.collection.insertOne(job as Document, session ? { session } : undefined),
      );
      const persistedJob = yield* attempt(
        () => ({ ...job, _id: result.insertedId }) as PersistedJob<T>,
      );
      if (!session?.inTransaction()) {
        yield* attempt(() => this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt));
      }
      return persistedJob;
    }).pipe(
      Effect.mapError((error) => {
        if (options.session?.inTransaction() || error instanceof ConnectionError) return error;
        const cause = toError(error);
        return new ConnectionError(`Failed to ${operation} job: ${cause.message}`, { cause });
      }),
    );
  });

  schedule = Effect.fnUntraced(function* <T>(
    this: JobIntake,
    cron: string,
    name: string,
    data: T,
    options: ScheduleOptions = {},
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    yield* attempt(() => {
      this.validateJobIdentifiers(name, options.uniqueKey);
      this.validatePayloadSize(data);
      validateJobPriority(options.priority);
    });
    const referenceDate = yield* DateTime.nowAsDate;
    const nextRunAt = yield* attempt(() => getNextCronDate(cron, referenceDate, options.timezone));
    const now = yield* DateTime.nowAsDate;
    const job = yield* attempt(() => {
      const pendingJob: Omit<Job<T>, "_id"> = {
        name,
        data,
        status: JobStatus.PENDING,
        nextRunAt,
        priority: options.priority ?? 0,
        repeatInterval: cron,
        failCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      if (options.timezone !== undefined) pendingJob.timezone = options.timezone;
      if (options.uniqueKey !== undefined) pendingJob.uniqueKey = options.uniqueKey;
      return pendingJob;
    });
    return yield* this.persistPendingJob("schedule", job, options);
  });

  private createEnqueuedJob = Effect.fnUntraced(function* <T>(
    this: JobIntake,
    name: string,
    data: T,
    options: EnqueueOptions,
  ): Effect.fn.Return<Omit<Job<T>, "_id">, unknown> {
    yield* attempt(() => {
      this.validateJobIdentifiers(name, options.uniqueKey);
      this.validatePayloadSize(data);
      validateJobPriority(options.priority);
    });

    const now = yield* DateTime.nowAsDate;
    const job: Omit<Job<T>, "_id"> = {
      name,
      data,
      status: JobStatus.PENDING,
      nextRunAt: options.runAt ?? now,
      priority: options.priority ?? 0,
      failCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (options.uniqueKey !== undefined) {
      job.uniqueKey = options.uniqueKey;
    }

    return job;
  });

  enqueue = Effect.fnUntraced(function* <T>(
    this: JobIntake,
    name: string,
    data: T,
    options: EnqueueOptions = {},
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    const job = yield* this.createEnqueuedJob(name, data, options);
    return yield* this.persistPendingJob("enqueue", job, options);
  });

  enqueueMany = Effect.fnUntraced(function* (
    this: JobIntake,
    inputs: readonly EnqueueJob[],
    options: JobWriteOptions = {},
  ): Effect.fn.Return<EnqueueManyResult, unknown> {
    const { session } = options;
    const jobs = yield* Effect.forEach(inputs, (input) =>
      this.createEnqueuedJob(input.name, input.data, input),
    );
    if (jobs.length === 0) return { insertedCount: 0, deduplicatedCount: 0 };

    let result: BulkWriteResult | undefined;
    const outcome = yield* fromPromise(() =>
      this.ctx.collection.bulkWrite(
        jobs.map((job) => ({
          updateOne: {
            filter:
              job.uniqueKey === undefined
                ? { _id: new ObjectId() }
                : {
                    name: job.name,
                    uniqueKey: job.uniqueKey,
                    status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
                  },
            update: { $setOnInsert: job },
            upsert: true,
          },
        })),
        { ordered: false, ...(session && { session }) },
      ),
    ).pipe(
      Effect.map((written) => {
        result = written;
        return { insertedCount: written.upsertedCount, deduplicatedCount: written.matchedCount };
      }),
      Effect.catch((error) =>
        Effect.gen({ self: this }, function* () {
          if (session?.inTransaction()) return yield* Effect.fail(error);
          if (error instanceof MongoBulkWriteError) {
            result = error.result;
            const reconciled = yield* this.reconcileBulkConflict(error, jobs, options);
            if (reconciled) return reconciled;
          }
          const cause = toError(error);
          return yield* Effect.fail(
            new ConnectionError(`Failed to enqueue jobs: ${cause.message}`, { cause }),
          );
        }),
      ),
      Effect.exit,
    );
    yield* attempt(() => {
      for (const index of Object.keys(result?.upsertedIds ?? {})) {
        const job = jobs[Number(index)];
        if (job && !session?.inTransaction()) this.ctx.notifyPendingJob(job.name, job.nextRunAt);
      }
    });
    return yield* outcome;
  });

  private reconcileBulkConflict = Effect.fnUntraced(function* (
    this: JobIntake,
    error: MongoBulkWriteError,
    jobs: Omit<Job, "_id">[],
    options: JobWriteOptions,
  ): Effect.fn.Return<EnqueueManyResult | undefined, unknown> {
    const result = error.result;
    const conflicts = yield* attempt(() => {
      const writeErrors = result.getWriteErrors();
      const duplicateJobs = writeErrors.flatMap(({ code, index }) => {
        const job = jobs[index];
        return code === 11000 && job?.uniqueKey !== undefined
          ? [{ name: job.name, uniqueKey: job.uniqueKey }]
          : [];
      });
      if (
        error.code !== 11000 ||
        duplicateJobs.length === 0 ||
        duplicateJobs.length !== writeErrors.length ||
        result.upsertedCount + result.matchedCount + duplicateJobs.length !== jobs.length ||
        result.getWriteConcernError()
      )
        return undefined;
      return duplicateJobs;
    });
    if (!conflicts) return undefined;

    const existing = yield* fromPromise(() =>
      this.ctx.collection
        .find(
          { $or: conflicts, status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] } },
          {
            projection: { name: 1, uniqueKey: 1 },
            readPreference: "primary",
            ...(options.session && { session: options.session }),
          },
        )
        .toArray(),
    ).pipe(Effect.orElseSucceed(() => []));
    const activeKeys = new Set(
      existing.map((job) => JSON.stringify([job["name"], job["uniqueKey"]])),
    );
    if (!conflicts.every((job) => activeKeys.has(JSON.stringify([job.name, job.uniqueKey]))))
      return undefined;
    return {
      insertedCount: result.upsertedCount,
      deduplicatedCount: result.matchedCount + conflicts.length,
    };
  });

  now = Effect.fnUntraced(function* <T>(
    this: JobIntake,
    name: string,
    data: T,
    options: NowOptions = {},
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    const runAt = yield* DateTime.nowAsDate;
    return yield* this.enqueue(name, data, { ...options, runAt });
  });
}
