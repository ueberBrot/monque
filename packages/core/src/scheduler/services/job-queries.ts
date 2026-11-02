import { Context, Effect, Layer } from "effect";

import { JobQueryService } from "./job-query.js";
import type { JobQueryDependencies } from "./job-query.js";

/** Instance-owned Job reads and invalidation, composed without a runtime runner. */
export class JobQueries extends Context.Service<JobQueries, JobQueryService>()(
  "@monque/core/scheduler/JobQueries",
) {}

export const makeJobQueriesLayer = (dependencies: JobQueryDependencies): Layer.Layer<JobQueries> =>
  Layer.effect(
    JobQueries,
    Effect.gen(function* acquireJobReads() {
      return new JobQueryService(dependencies, yield* Effect.scope);
    }),
  );
