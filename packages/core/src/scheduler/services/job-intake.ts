import { Context, DateTime, Effect, Layer } from "effect";
import { forEach as forEachEffect } from "effect/Effect";
import { BSON, MongoBulkWriteError, MongoServerError, ObjectId } from "mongodb";
import type {
  BulkWriteResult,
  ClientSession,
  Collection,
  Document,
  Filter,
  WriteError,
} from "mongodb";

import { documentToPersistedJob, JobStatus } from "@/jobs";
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
  MonqueError,
  PayloadTooLargeError,
  toError,
  validateJobName,
  validateUniqueKey,
} from "@/shared";

import { validateJobPriority } from "../../shared/utils/job-priority.js";
import { validateJobRunAt } from "../../shared/utils/job-run-at.js";
import { attempt, fromPromise } from "../effects.js";
import type { MonqueOptions } from "../types.js";
import { JobPersistenceError } from "./job-persistence-error.js";
import { makeOperationTelemetry } from "./operation-telemetry.js";

const isUniqueJobIndexPattern = (value: unknown): value is { name: 1; uniqueKey: 1 } => {
  if (typeof value !== "object" || value === null || !("name" in value)) {
    return false;
  }

  return (
    value.name === 1 &&
    "uniqueKey" in value &&
    value.uniqueKey === 1 &&
    Object.keys(value).length === 2
  );
};

const isUniqueJobBulkConflict = (error: WriteError): boolean => {
  const pattern: unknown = error.errInfo?.["keyPattern"];

  if (pattern !== undefined) {
    return isUniqueJobIndexPattern(pattern);
  }

  const [description, key] = error.errmsg?.split(" dup key: ", 2) ?? [];

  return key !== undefined && description?.endsWith(" index: name_1_uniqueKey_1") === true;
};

/** Native intake borrows the collection and caller sessions; routing remains synchronous. */
interface JobIntakeDependencies {
  readonly collection: Collection;
  readonly options: Pick<MonqueOptions, "maxPayloadSize">;
  readonly notifyPendingJob: (name: string, nextRunAt: Date) => void;
}

const intakeFailure = (cause: unknown) => {
  if (cause instanceof MonqueError || cause instanceof JobPersistenceError) {
    return cause;
  }

  return new JobPersistenceError({ cause });
};

const validateJobIdentifiers = (name: string, uniqueKey?: string): void => {
  validateJobName(name);

  if (uniqueKey !== undefined) {
    validateUniqueKey(uniqueKey);
  }
};

/** One native intake policy for immediate, delayed, batch and recurring Jobs. @internal */
export const makeNativeJobIntake = (
  dependencies: JobIntakeDependencies,
  telemetry = makeOperationTelemetry(),
) => {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Job payloads intentionally accept every BSON-serializable value; size validation must not add a payload schema.
  const validatePayloadSize = (data: unknown): void => {
    const maxSize = dependencies.options.maxPayloadSize;

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
  };

  const recoverDuplicateJob = Effect.fnUntraced(function* recoverDuplicateJobEffect(
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The native driver can reject with any value; reconcile only its known active-key collision.
    failure: unknown,
    filter: Filter<Document>,
    session: ClientSession | undefined,
  ) {
    if (session?.inTransaction() === true) {
      return yield* Effect.fail(failure);
    }

    if (!(failure instanceof MongoServerError) || failure.code !== 11_000) {
      return yield* Effect.fail(failure);
    }

    if (!isUniqueJobIndexPattern(failure["keyPattern"])) {
      return yield* Effect.fail(failure);
    }

    const existing = yield* fromPromise(
      async () =>
        await dependencies.collection.findOne(filter, {
          readPreference: "primary",
          ...(session && { session }),
        }),
    );

    return existing ?? (yield* Effect.fail(failure));
  });

  const persistPendingJob = Effect.fnUntraced(function* persistPendingJobEffect<T>(
    operation: "enqueue" | "schedule",
    job: Omit<Job<T>, "_id">,
    options: EnqueueOptions | ScheduleOptions,
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    return yield* Effect.gen(function* writePendingJob() {
      const { uniqueKey, session } = options;

      if (uniqueKey !== undefined) {
        const filter = {
          name: job.name,
          uniqueKey,
          status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
        };

        const result = yield* fromPromise(
          async () =>
            await dependencies.collection.findOneAndUpdate(
              filter,
              { $setOnInsert: job },
              {
                upsert: true,
                returnDocument: "after",
                ...(session && { session }),
              },
            ),
        ).pipe(Effect.catch((error) => recoverDuplicateJob(error, filter, session)));

        if (!result) {
          return yield* Effect.fail(
            new ConnectionError(
              `Failed to ${operation} job: findOneAndUpdate returned no document`,
            ),
          );
        }

        const persistedJob = yield* attempt(() => documentToPersistedJob<T>(result));

        if (persistedJob.status === JobStatus.PENDING && session?.inTransaction() !== true) {
          yield* attempt(() => {
            dependencies.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
          });
        }

        return persistedJob;
      }

      const result = yield* fromPromise(
        async () => await dependencies.collection.insertOne(job, session ? { session } : undefined),
      );

      const persistedJob = yield* attempt(() => ({ ...job, _id: result.insertedId }));

      if (session?.inTransaction() !== true) {
        yield* attempt(() => {
          dependencies.notifyPendingJob(persistedJob.name, persistedJob.nextRunAt);
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

  const schedule = Effect.fnUntraced(
    function* scheduleJob<T>(
      cron: string,
      name: string,
      data: T,
      options: ScheduleOptions = {},
    ): Effect.fn.Return<PersistedJob<T>, unknown> {
      yield* attempt(() => {
        validateJobIdentifiers(name, options.uniqueKey);
        validatePayloadSize(data);
        validateJobPriority(options.priority);
      });

      const referenceDate = yield* DateTime.nowAsDate;

      const nextRunAt = yield* attempt(() =>
        getNextCronDate(cron, referenceDate, options.timezone),
      );

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

      return yield* persistPendingJob("schedule", job, options);
    },
    Effect.mapError(intakeFailure),
    (body) => telemetry.observe("intake.schedule", body),
  );

  const createEnqueuedJob = Effect.fnUntraced(function* constructEnqueuedJob<T>(
    name: string,
    data: T,
    options: EnqueueOptions,
  ): Effect.fn.Return<Omit<Job<T>, "_id">, unknown> {
    yield* attempt(() => {
      validateJobIdentifiers(name, options.uniqueKey);
      validatePayloadSize(data);
      validateJobPriority(options.priority);

      if (options.runAt !== undefined) {
        validateJobRunAt(options.runAt);
      }
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

  const enqueue = Effect.fnUntraced(
    function* enqueueJob<T>(
      name: string,
      data: T,
      options: EnqueueOptions = {},
    ): Effect.fn.Return<PersistedJob<T>, unknown> {
      const job = yield* createEnqueuedJob(name, data, options);

      return yield* persistPendingJob("enqueue", job, options);
    },
    Effect.mapError(intakeFailure),
    (body) => telemetry.observe("intake.enqueue", body),
  );

  const reconcileBulkConflict = Effect.fnUntraced(function* reconcileConflictingJobs(
    failure: MongoBulkWriteError,
    jobs: Omit<Job, "_id">[],
    options: JobWriteOptions,
  ): Effect.fn.Return<EnqueueManyResult | undefined, unknown> {
    const { result } = failure;

    const conflicts = yield* attempt(() => {
      const writeErrors = result.getWriteErrors();

      const duplicateJobs = writeErrors.flatMap((error) => {
        const job = jobs[error.index];

        return error.code === 11_000 &&
          job?.uniqueKey !== undefined &&
          isUniqueJobBulkConflict(error)
          ? [{ name: job.name, uniqueKey: job.uniqueKey }]
          : [];
      });

      if (failure.code !== 11_000 || duplicateJobs.length === 0) {
        return null;
      }

      if (
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
      const { collection } = dependencies;

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

  const enqueueMany = Effect.fnUntraced(
    function* enqueueJobBatch(
      inputs: readonly EnqueueJob[],
      options: JobWriteOptions = {},
    ): Effect.fn.Return<EnqueueManyResult, unknown> {
      const { session } = options;

      const jobs = yield* forEachEffect(inputs, (input) =>
        createEnqueuedJob(input.name, input.data, input),
      );

      if (jobs.length === 0) {
        return { insertedCount: 0, deduplicatedCount: 0 };
      }

      let result: BulkWriteResult | undefined;

      const outcome = yield* fromPromise(
        async () =>
          await dependencies.collection.bulkWrite(
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
          Effect.gen(function* recoverBulkConflict() {
            if (session?.inTransaction() === true) {
              return yield* Effect.fail(error);
            }

            if (error instanceof MongoBulkWriteError) {
              ({ result } = error);

              const reconciled = yield* reconcileBulkConflict(error, jobs, options);

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
            dependencies.notifyPendingJob(job.name, job.nextRunAt);
          }
        }
      });

      return yield* outcome;
    },
    Effect.mapError(intakeFailure),
    (body) => telemetry.observe("intake.batch", body),
  );

  const now = Effect.fnUntraced(function* enqueueImmediateJob<T>(
    name: string,
    data: T,
    options: NowOptions = {},
  ): Effect.fn.Return<PersistedJob<T>, unknown> {
    const runAt = yield* DateTime.nowAsDate;

    return yield* enqueue(name, data, { ...options, runAt });
  }, Effect.mapError(intakeFailure));

  return { enqueue, now, enqueueMany, schedule };
};

export class JobIntake extends Context.Service<JobIntake, ReturnType<typeof makeNativeJobIntake>>()(
  "@monque/core/scheduler/JobIntake",
) {}

export const makeNativeJobIntakeLayer = (
  dependencies: JobIntakeDependencies,
  telemetry = makeOperationTelemetry(),
) => Layer.succeed(JobIntake, makeNativeJobIntake(dependencies, telemetry));
