import { Context, Effect, Layer } from "effect";
import type { Collection, ObjectId } from "mongodb";

import { documentToPersistedJob } from "@/jobs";
import type { PersistedJob } from "@/jobs";

import { JobPersistenceError } from "./job-persistence-error.js";

/** Semantic persistence capabilities, expanded as each behavior migrates. @internal */
export class JobPersistence extends Context.Service<
  JobPersistence,
  {
    readonly getJob: <T = unknown>(
      id: ObjectId,
    ) => Effect.Effect<PersistedJob<T> | null, JobPersistenceError>;
  }
>()("@monque/core/scheduler/JobPersistence") {}

/** Borrows the native collection. Never owns the Db, MongoClient or caller sessions. */
export const makeNativeJobPersistenceLayer = (
  collection: Collection,
): Layer.Layer<JobPersistence> =>
  Layer.succeed(JobPersistence, {
    getJob: <T = unknown>(id: ObjectId) =>
      Effect.tryPromise({
        try: async () => {
          const doc = await collection.findOne({ _id: id });

          return doc ? documentToPersistedJob<T>(doc) : null;
        },
        catch: (cause) => new JobPersistenceError({ cause }),
      }),
  });
