import { Context, Effect, Layer, Scope } from "effect";

import { JobOwnership } from "./job-ownership.js";
import { JobProcessor } from "./job-processor.js";
import type { ExecutionDependencies, ExecutionDrain } from "./job-processor.js";
import { WorkerAdmission } from "./worker-admission.js";

export class JobExecution extends Context.Service<
  JobExecution,
  {
    readonly poll: (
      targetNames?: ReadonlySet<string>,
      isCurrent?: () => boolean,
    ) => Effect.Effect<void, unknown>;
    readonly captureDrain: () => ExecutionDrain;
  }
>()("@monque/core/scheduler/JobExecution") {}

export const makeJobExecution = Effect.fnUntraced(function* makeJobExecution(
  dependencies: ExecutionDependencies,
) {
  return new JobProcessor(
    dependencies,
    yield* JobOwnership,
    yield* WorkerAdmission,
    yield* Scope.Scope,
  );
});

export const makeJobExecutionLayer = (dependencies: ExecutionDependencies) =>
  Layer.effect(JobExecution, makeJobExecution(dependencies));
