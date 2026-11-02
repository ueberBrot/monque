import { Context, Effect, Layer, Scope } from "effect";

import { JobOwnership } from "./job-ownership.js";
import { JobProcessor } from "./job-processor.js";
import type { ExecutionDependencies, ExecutionDrain } from "./job-processor.js";
import { makeOperationTelemetry } from "./operation-telemetry.js";
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
  telemetry: ReturnType<typeof makeOperationTelemetry> = makeOperationTelemetry(),
) {
  return new JobProcessor(
    dependencies,
    yield* JobOwnership,
    yield* WorkerAdmission,
    yield* Scope.Scope,
    telemetry,
  );
});

export const makeJobExecutionLayer = (
  dependencies: ExecutionDependencies,
  telemetry: ReturnType<typeof makeOperationTelemetry> = makeOperationTelemetry(),
) => Layer.effect(JobExecution, makeJobExecution(dependencies, telemetry));
