import { Clock, Context, Effect, Layer } from "effect";
import type { Fiber } from "effect";

import { ChangeStreamHandler } from "./services/change-stream-handler.js";
import { JobIntake } from "./services/job-intake.js";
import { JobLifecycle } from "./services/job-lifecycle.js";
import { JobManager } from "./services/job-manager.js";
import { JobOwnership, makeNativeJobOwnershipLayer } from "./services/job-ownership.js";
import { makeNativeJobPersistenceLayer } from "./services/job-persistence.js";
import type { JobPersistence } from "./services/job-persistence.js";
import { JobProcessor } from "./services/job-processor.js";
import { JobQueries, makeJobQueriesLayer } from "./services/job-queries.js";
import { makeSchedulerMaintenance } from "./services/lifecycle-manager.js";
import type { SchedulerMaintenance } from "./services/lifecycle-manager.js";
import { PendingNotificationRouter } from "./services/pending-notification-router.js";
import type { SchedulerContext } from "./services/types.js";
import { WorkerAdmission } from "./services/worker-admission.js";

interface SchedulerExecution {
  readonly runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>;
}

/** Temporary adapter for behavior not yet migrated to focused core services. */
export class SchedulerServices extends Context.Service<
  SchedulerServices,
  {
    readonly intake: JobIntake;
    readonly manager: JobManager;
    readonly queries: JobQueries["Service"];
    readonly notifications: PendingNotificationRouter;
    readonly streams: ChangeStreamHandler;
    readonly timers: SchedulerMaintenance;
  }
>()("@monque/core/scheduler/Services") {}

const makeLegacySchedulerLayer = (
  environment: SchedulerContext,
  execution: SchedulerExecution,
): Layer.Layer<SchedulerServices, unknown, JobOwnership | JobQueries> =>
  Layer.effect(
    SchedulerServices,
    Effect.gen(function* constructSchedulerServices() {
      const ownership = yield* JobOwnership;
      const lifecycle = new JobLifecycle(environment, ownership);

      if (environment.options.recoverStaleJobs) {
        yield* lifecycle.recoverStaleJobs();
      }

      yield* lifecycle.assertNoActiveInstanceCollision();
      const clock = yield* Clock.Clock;
      const processing = new JobProcessor(environment, lifecycle);

      const notifications = new PendingNotificationRouter(
        environment,
        (targetNames) => processing.poll(targetNames),
        execution.runFork,
        clock,
      );

      return {
        intake: new JobIntake(environment),
        manager: new JobManager(environment),
        queries: yield* JobQueries,
        notifications,
        streams: new ChangeStreamHandler(environment, notifications, execution.runFork),
        timers: yield* makeSchedulerMaintenance({
          options: environment.options,
          collection: environment.collection,
          ownership,
          activeClaimIds: () => {
            const claimIds: string[] = [];

            for (const worker of environment.workers.values()) {
              for (const job of worker.activeJobs.values()) {
                if (job.claimId !== undefined && job.claimId !== "") {
                  claimIds.push(job.claimId);
                }
              }
            }

            return claimIds;
          },
          emit: environment.emit,
          notifyPendingJob: environment.notifyPendingJob,
        }),
      };
    }),
  );

/**
 * Instance composition only: building these Layers must not start a processing run.
 * The Node adapter supplies the runner for legacy background work and owns the
 * runtime. Focused services compose Effects directly; they do not use that runner.
 */
export const makeSchedulerLayer = (
  environment: SchedulerContext,
  execution: SchedulerExecution,
  persistence: Layer.Layer<JobPersistence, unknown> = makeNativeJobPersistenceLayer(
    environment.collection,
  ),
) =>
  Layer.mergeAll(
    makeLegacySchedulerLayer(environment, execution),
    persistence,
    Layer.succeed(WorkerAdmission, environment.admission),
  ).pipe(
    Layer.provideMerge(
      Layer.merge(
        makeNativeJobOwnershipLayer(
          environment.collection,
          environment.instanceId,
          environment.options,
        ),
        makeJobQueriesLayer(environment),
      ),
    ),
  );
