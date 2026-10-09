import * as DateTime from "effect/DateTime";
import { forEach as forEachEffect } from "effect/Effect";
import * as Effect from "effect/Effect";
import { BSON, MongoBulkWriteError, MongoServerError, ObjectId } from "mongodb";
import type { BulkWriteResult } from "mongodb";

import { JobStatus } from "@/jobs";
import type {
  EnqueueJob,
  EnqueueManyResult,
  EnqueueOptions,
  Job,
  JobWriteOptions,
  NowOptions,
  PersistedJob,
  ScheduleOptions,
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

const isUniqueJobIndexPattern = (value: unknown): value is { name: 1; uniqueKey: 1 } =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  value.name === 1 &&
  "uniqueKey" in value &&
  value.uniqueKey === 1 &&
  Object.keys(value).length === 2;

/**
 * Internal module for creating pending jobs.
 *
 * Keeps validation, initial job document construction, persistence, and local
 * pending-job notification in one place.
 *
 * Not part of public API - use Monque class methods instead.
 * @internal
 */
export class JobIntake {
  private readonly ctx: SchedulerContext;
  constructor(ctx: SchedulerContext) {
    this.ctx = ctx;
  }
  private static validateJobIdentifiers(name: string, uniqueKey?: string): void {
    validateJobName(name);
    if (uniqueKey !== undefined) {
      validateUniqueKey(uniqueKey);
    }
  }
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Job payloads intentionally accept every BSON-serializable value; size validation must not add a payload schema.
  private validatePayloadSize(data: unknown): void {
    const maxSize = this.ctx.options.maxPayloadSize;
    if (maxSize === undefined) {
      return;
    }
    let size: number;
    try {
      size = BSON.calculateObjectSize({ data });
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
  private readonly persistPendingJob = Effect.fnUntraced(function* persistPendingJobEffect<T>(
    this: JobIntake,
    operation: "enqueue" | "schedule",
    job: Omit<Job<T>, "_id">,
    options: EnqueueOptions | ScheduleOptions,
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    return yield* Effect.gen({ self: this }, function* writePendingJob() {
      const { uniqueKey, session } = options;
      if (uniqueKey !== undefined) {
        const filter = {
          name: job.name,
          uniqueKey,
          status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
        };
        const result = yield* fromPromise(
          async () =>
            await this.ctx.collection.findOneAndUpdate(
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
            Effect.gen({ self: this }, function* recoverDuplicateJob() {
              if (session?.inTransaction() === true) {
                return yield* Effect.fail(error);
              }
              if (!(error instanceof MongoServerError) || error.code !== 11_000) {
                return yield* Effect.fail(error);
              }
              const pattern: unknown = error["keyPattern"];
              if (!isUniqueJobIndexPattern(pattern)) {
                return yield* Effect.fail(error);
              }
              const existing = yield* fromPromise(
                async () =>
                  await this.ctx.collection.findOne(filter, {
                    readPreference: "primary",
                    ...(session && { session }),
                  }),
              );
              if (!existing) {
                return yield* Effect.fail(error);
              }
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
        if (persistedJob.status === JobStatus.PENDING && session?.inTransaction() !== true) {
          yield* attempt(() => {
            this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
          });
        }
        return persistedJob;
      }
      const result = yield* fromPromise(
        async () => await this.ctx.collection.insertOne(job, session ? { session } : undefined),
      );
      const persistedJob = yield* attempt(() => ({ ...job, _id: result.insertedId }));
      if (session?.inTransaction() !== true) {
        yield* attempt(() => {
          this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
        });
      }
      return persistedJob;
    }).pipe(
      Effect.mapError((error) => {
        if (options.session?.inTransaction() === true || error instanceof ConnectionError) {
          return error;
        }
        const cause = toError(error);
        return new ConnectionError(`Failed to ${operation} job: ${cause.message}`, { cause });
      }),
    );
  });
  schedule = Effect.fnUntraced(function* scheduleJob<T>(
    this: JobIntake,
    cron: string,
    name: string,
    data: T,
    options: ScheduleOptions = {},
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    yield* attempt(() => {
      JobIntake.validateJobIdentifiers(name, options.uniqueKey);
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
      if (options.timezone !== undefined) {
        pendingJob.timezone = options.timezone;
      }
      if (options.uniqueKey !== undefined) {
        pendingJob.uniqueKey = options.uniqueKey;
      }
      return pendingJob;
    });
    return yield* this.persistPendingJob("schedule", job, options);
  });
  private readonly createEnqueuedJob = Effect.fnUntraced(function* constructEnqueuedJob<T>(
    this: JobIntake,
    name: string,
    data: T,
    options: EnqueueOptions,
  ): Effect.fn.Return<Omit<Job<T>, "_id">, unknown> {
    yield* attempt(() => {
      JobIntake.validateJobIdentifiers(name, options.uniqueKey);
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
  enqueue = Effect.fnUntraced(function* enqueueJob<T>(
    this: JobIntake,
    name: string,
    data: T,
    options: EnqueueOptions = {},
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    const job = yield* this.createEnqueuedJob(name, data, options);
    return yield* this.persistPendingJob("enqueue", job, options);
  });
  enqueueMany = Effect.fnUntraced(function* enqueueJobBatch(
    this: JobIntake,
    inputs: readonly EnqueueJob[],
    options: JobWriteOptions = {},
  ): Effect.fn.Return<EnqueueManyResult, unknown> {
    const { session } = options;
    const jobs = yield* forEachEffect(inputs, (input) =>
      this.createEnqueuedJob(input.name, input.data, input),
    );
    if (jobs.length === 0) {
      return { insertedCount: 0, deduplicatedCount: 0 };
    }
    let result: BulkWriteResult | undefined;
    const outcome = yield* fromPromise(
      async () =>
        await this.ctx.collection.bulkWrite(
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
        Effect.gen({ self: this }, function* recoverBulkConflict() {
          if (session?.inTransaction() === true) {
            return yield* Effect.fail(error);
          }
          if (error instanceof MongoBulkWriteError) {
            ({ result } = error);
            const reconciled = yield* this.reconcileBulkConflict(error, jobs, options);
            if (reconciled) {
              return reconciled;
            }
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
        if (job && session?.inTransaction() !== true) {
          this.ctx.notifyPendingJob(job.name, job.nextRunAt);
        }
      }
    });
    return yield* outcome;
  });
  private readonly reconcileBulkConflict = Effect.fnUntraced(function* reconcileConflictingJobs(
    this: JobIntake,
    failure: MongoBulkWriteError,
    jobs: Omit<Job, "_id">[],
    options: JobWriteOptions,
  ): Effect.fn.Return<EnqueueManyResult | undefined, unknown> {
    const { result } = failure;
    const conflicts = yield* attempt(() => {
      const writeErrors = result.getWriteErrors();
      const duplicateJobs = writeErrors.flatMap(({ code, index }) => {
        const job = jobs[index];
        return code === 11_000 && job?.uniqueKey !== undefined
          ? [{ name: job.name, uniqueKey: job.uniqueKey }]
          : [];
      });
      if (
        failure.code !== 11_000 ||
        duplicateJobs.length === 0 ||
        duplicateJobs.length !== writeErrors.length ||
        result.upsertedCount + result.matchedCount + duplicateJobs.length !== jobs.length ||
        result.getWriteConcernError()
      ) {
        return null;
      }
      return duplicateJobs;
    });
    if (!conflicts) {
      return undefined;
    }
    const existing = yield* fromPromise(async () => {
      const { collection } = this.ctx;
      const findConflictingJobs = collection.find.bind(collection);
      return await findConflictingJobs(
        { $or: conflicts, status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] } },
        {
          projection: { name: 1, uniqueKey: 1 },
          readPreference: "primary",
          ...(options.session && { session: options.session }),
        },
      ).toArray();
    }).pipe(Effect.orElseSucceed(() => []));
    const activeKeys = new Set(
      existing.map((job) => JSON.stringify([job["name"], job["uniqueKey"]])),
    );
    if (!conflicts.every((job) => activeKeys.has(JSON.stringify([job.name, job.uniqueKey])))) {
      return undefined;
    }
    return {
      insertedCount: result.upsertedCount,
      deduplicatedCount: result.matchedCount + conflicts.length,
    };
  });
  now = Effect.fnUntraced(function* enqueueImmediateJob<T>(
    this: JobIntake,
    name: string,
    data: T,
    options: NowOptions = {},
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    const runAt = yield* DateTime.nowAsDate;
    return yield* this.enqueue(name, data, { ...options, runAt });
  });
}
