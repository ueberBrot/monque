import { Context, DateTime, Effect, Layer } from "effect";
import type { Collection } from "mongodb";

import type { MonqueEventMap } from "@/events";
import { ConnectionError } from "@/shared";

import { attempt } from "./effects.js";
import { makeChangeStreamHandler } from "./services/change-stream-handler.js";
import type { ChangeStreamHandler } from "./services/change-stream-handler.js";
import { JobExecution, makeJobExecutionLayer } from "./services/job-execution.js";
import { makeNativeJobIntakeLayer } from "./services/job-intake.js";
import { makeJobManagementLayer } from "./services/job-manager.js";
import { JobOwnership, makeNativeJobOwnershipLayer } from "./services/job-ownership.js";
import { makeNativeJobPersistenceLayer } from "./services/job-persistence.js";
import type { JobPersistence } from "./services/job-persistence.js";
import { makeJobQueriesLayer } from "./services/job-queries.js";
import { makeSchedulerMaintenance } from "./services/lifecycle-manager.js";
import type { SchedulerMaintenance } from "./services/lifecycle-manager.js";
import { OperationTelemetry, makeOperationTelemetryLayer } from "./services/operation-telemetry.js";
import { makePendingNotificationRouter } from "./services/pending-notification-router.js";
import type { PendingNotificationRouter } from "./services/pending-notification-router.js";
import type { ResolvedMonqueOptions } from "./services/types.js";
import { WorkerAdmission } from "./services/worker-admission.js";

/** Borrowed native inputs and the constructor-owned admission state. */
interface SchedulerDependencies {
  readonly collection: Collection;
  readonly options: ResolvedMonqueOptions;
  readonly admission: WorkerAdmission["Service"];
  readonly emit: <K extends keyof MonqueEventMap>(event: K, payload: MonqueEventMap[K]) => boolean;
  readonly notifyPendingJob: (name: string | undefined, nextRunAt: Date) => void;
  readonly notifyJobFinished: (name: string) => void;
}

/** Instance-owned handles giving the synchronous facade control of processing resources. */
export class ProcessingResources extends Context.Service<
  ProcessingResources,
  {
    readonly notifications: PendingNotificationRouter;
    readonly streams: ChangeStreamHandler;
    readonly timers: SchedulerMaintenance;
  }
>()("@monque/core/scheduler/ProcessingResources") {}

const makeProcessingResourcesLayer = ({
  collection,
  options,
  emit,
  notifyPendingJob,
}: Pick<SchedulerDependencies, "collection" | "options" | "emit" | "notifyPendingJob">) =>
  Layer.effect(
    ProcessingResources,
    Effect.gen(function* acquireProcessingResources() {
      const ownership = yield* JobOwnership;

      if (options.recoverStaleJobs) {
        const count = yield* ownership.recoverStaleJobs.pipe(
          Effect.mapError((failure) => failure.cause),
        );

        if (count > 0) {
          const nextRunAt = yield* DateTime.nowAsDate;
          yield* attempt(() => {
            emit("stale:recovered", { count });
            notifyPendingJob(undefined, nextRunAt);
          });
        }
      }

      const name = yield* ownership.findActiveInstanceJob.pipe(
        Effect.mapError((failure) => failure.cause),
      );

      yield* attempt(() => {
        if (name !== null) {
          throw new ConnectionError(
            `Another active Monque instance is using schedulerInstanceId "${options.schedulerInstanceId}". ` +
              `Found processing job "${name}" with recent heartbeat. ` +
              `Use a unique schedulerInstanceId or wait for the other instance to stop.`,
          );
        }
      });

      const processing = yield* JobExecution;
      const admission = yield* WorkerAdmission;
      const isRunning = () => admission.running;

      const notifications = yield* makePendingNotificationRouter(
        { options, isRunning, emit },
        (targetNames, isCurrent) => processing.poll(targetNames, isCurrent),
      );

      return {
        notifications,
        streams: yield* makeChangeStreamHandler({ collection, isRunning, emit }, notifications),
        timers: yield* makeSchedulerMaintenance({
          options,
          collection,
          ownership,
          activeClaimIds: () =>
            admission
              .activeJobs()
              .flatMap((job) =>
                job.claimId !== undefined && job.claimId !== "" ? [job.claimId] : [],
              ),
          emit,
          notifyPendingJob,
        }),
      };
    }),
  );

/** Instance composition acquires owners without starting a processing generation. */
export const makeSchedulerLayer = (
  {
    collection,
    options,
    admission,
    emit,
    notifyPendingJob,
    notifyJobFinished,
  }: SchedulerDependencies,
  persistence: Layer.Layer<JobPersistence, unknown> = makeNativeJobPersistenceLayer(collection),
  telemetryLayer = makeOperationTelemetryLayer,
) =>
  Layer.unwrap(
    Effect.gen(function* composeScheduler() {
      const telemetry = yield* OperationTelemetry;

      return Layer.mergeAll(
        makeProcessingResourcesLayer({ collection, options, emit, notifyPendingJob }),
        persistence,
        makeJobManagementLayer({ collection, emit, notifyPendingJob }),
        makeNativeJobIntakeLayer({ collection, options, notifyPendingJob }, telemetry),
      ).pipe(
        Layer.provideMerge(
          makeJobExecutionLayer(
            { collection, options, emit, notifyPendingJob, notifyJobFinished },
            telemetry,
          ),
        ),
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(WorkerAdmission, admission),
            makeNativeJobOwnershipLayer(
              collection,
              options.schedulerInstanceId,
              options,
              telemetry,
            ),
            makeJobQueriesLayer({
              collection,
              options,
              workers: admission.workers,
              isPaused: (name) => admission.isPaused(name),
            }),
          ),
        ),
      );
    }),
  ).pipe(Layer.provideMerge(telemetryLayer));
