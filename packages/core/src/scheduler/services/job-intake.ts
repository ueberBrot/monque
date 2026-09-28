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

  private async persistPendingJob<T>(
    operation: "enqueue" | "schedule",
    job: Omit<Job<T>, "_id">,
    options: EnqueueOptions | ScheduleOptions,
  ): Promise<PersistedJob<T>> {
    try {
      const { uniqueKey, session } = options;
      if (uniqueKey !== undefined) {
        const filter = {
          name: job.name,
          uniqueKey,
          status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
        };
        const result = await this.ctx.collection
          .findOneAndUpdate(
            filter,
            {
              $setOnInsert: job,
            },
            {
              upsert: true,
              returnDocument: "after",
              ...(session && { session }),
            },
          )
          .catch(async (error: unknown) => {
            if (session?.inTransaction()) throw error;
            if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
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
              throw error;
            const existing = await this.ctx.collection.findOne(filter, {
              readPreference: "primary",
              ...(session && { session }),
            });
            if (!existing) throw error;
            return existing;
          });

        if (!result) {
          throw new ConnectionError(
            `Failed to ${operation} job: findOneAndUpdate returned no document`,
          );
        }

        const persistedJob = this.ctx.documentToPersistedJob<T>(result);
        if (persistedJob.status === JobStatus.PENDING && !session?.inTransaction()) {
          this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
        }

        return persistedJob;
      }

      const result = await this.ctx.collection.insertOne(
        job as Document,
        session ? { session } : undefined,
      );
      const persistedJob = { ...job, _id: result.insertedId } as PersistedJob<T>;
      if (!session?.inTransaction())
        this.ctx.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);

      return persistedJob;
    } catch (error) {
      if (options.session?.inTransaction() || error instanceof ConnectionError) throw error;
      const cause = toError(error);
      throw new ConnectionError(`Failed to ${operation} job: ${cause.message}`, { cause });
    }
  }

  async schedule<T>(
    cron: string,
    name: string,
    data: T,
    options: ScheduleOptions = {},
  ): Promise<PersistedJob<T>> {
    this.validateJobIdentifiers(name, options.uniqueKey);
    this.validatePayloadSize(data);

    const nextRunAt = getNextCronDate(cron, undefined, options.timezone);
    const now = new Date();
    const job: Omit<Job<T>, "_id"> = {
      name,
      data,
      status: JobStatus.PENDING,
      nextRunAt,
      repeatInterval: cron,
      failCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (options.timezone !== undefined) {
      job.timezone = options.timezone;
    }

    if (options.uniqueKey !== undefined) {
      job.uniqueKey = options.uniqueKey;
    }

    return this.persistPendingJob("schedule", job, options);
  }

  private createEnqueuedJob<T>(
    name: string,
    data: T,
    options: EnqueueOptions,
  ): Omit<Job<T>, "_id"> {
    this.validateJobIdentifiers(name, options.uniqueKey);
    this.validatePayloadSize(data);

    const now = new Date();
    const job: Omit<Job<T>, "_id"> = {
      name,
      data,
      status: JobStatus.PENDING,
      nextRunAt: options.runAt ?? now,
      failCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (options.uniqueKey !== undefined) {
      job.uniqueKey = options.uniqueKey;
    }

    return job;
  }

  async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<PersistedJob<T>> {
    const job = this.createEnqueuedJob(name, data, options);
    return this.persistPendingJob("enqueue", job, options);
  }

  async enqueueMany(
    inputs: readonly EnqueueJob[],
    options: JobWriteOptions = {},
  ): Promise<EnqueueManyResult> {
    const { session } = options;
    const jobs = inputs.map((input) => this.createEnqueuedJob(input.name, input.data, input));
    if (jobs.length === 0) return { insertedCount: 0, deduplicatedCount: 0 };

    let result: BulkWriteResult | undefined;
    try {
      result = await this.ctx.collection.bulkWrite(
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
      );
      return { insertedCount: result.upsertedCount, deduplicatedCount: result.matchedCount };
    } catch (error) {
      if (session?.inTransaction()) throw error;
      if (error instanceof MongoBulkWriteError) {
        result = error.result;
        const reconciled = await this.reconcileBulkConflict(error, jobs, options);
        if (reconciled) return reconciled;
      }
      const cause = toError(error);
      throw new ConnectionError(`Failed to enqueue jobs: ${cause.message}`, { cause });
    } finally {
      for (const index of Object.keys(result?.upsertedIds ?? {})) {
        const job = jobs[Number(index)];
        if (job && !session?.inTransaction()) this.ctx.notifyPendingJob(job.name, job.nextRunAt);
      }
    }
  }

  private async reconcileBulkConflict(
    error: MongoBulkWriteError,
    jobs: Omit<Job, "_id">[],
    options: JobWriteOptions,
  ): Promise<EnqueueManyResult | undefined> {
    const result = error.result;
    const writeErrors = result.getWriteErrors();
    const conflicts = writeErrors.flatMap(({ code, index }) => {
      const job = jobs[index];
      return code === 11000 && job?.uniqueKey !== undefined
        ? [{ name: job.name, uniqueKey: job.uniqueKey }]
        : [];
    });
    if (
      error.code !== 11000 ||
      conflicts.length === 0 ||
      conflicts.length !== writeErrors.length ||
      result.upsertedCount + result.matchedCount + conflicts.length !== jobs.length ||
      result.getWriteConcernError()
    )
      return undefined;

    const existing = await this.ctx.collection
      .find(
        { $or: conflicts, status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] } },
        {
          projection: { name: 1, uniqueKey: 1 },
          readPreference: "primary",
          ...(options.session && { session: options.session }),
        },
      )
      .toArray()
      .catch(() => []);
    const activeKeys = new Set(
      existing.map((job) => JSON.stringify([job["name"], job["uniqueKey"]])),
    );
    if (!conflicts.every((job) => activeKeys.has(JSON.stringify([job.name, job.uniqueKey]))))
      return undefined;
    return {
      insertedCount: result.upsertedCount,
      deduplicatedCount: result.matchedCount + conflicts.length,
    };
  }

  async now<T>(name: string, data: T): Promise<PersistedJob<T>> {
    return this.enqueue(name, data, { runAt: new Date() });
  }
}
