import { Clock, Context, DateTime, Effect, Layer } from "effect";
import type { Collection } from "mongodb";

import type { MonqueEventMap } from "@/events";
import { ConnectionError, ShutdownTimeoutError } from "@/shared";

import { attempt } from "./effects.js";
import { makeChangeStreamHandler } from "./services/change-stream-handler.js";
import { JobExecution, makeJobExecutionLayer } from "./services/job-execution.js";
import { makeNativeJobIntakeLayer } from "./services/job-intake.js";
import { makeJobManagementLayer } from "./services/job-manager.js";
import { JobOwnership, makeNativeJobOwnershipLayer } from "./services/job-ownership.js";
import { makeNativeJobPersistenceLayer } from "./services/job-persistence.js";
import type { JobPersistence } from "./services/job-persistence.js";
import { JobQueries, makeJobQueriesLayer } from "./services/job-queries.js";
import { makeSchedulerMaintenance } from "./services/lifecycle-manager.js";
import type { MaintenanceRun } from "./services/lifecycle-manager.js";
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
}

export class Processing extends Context.Service<
  Processing,
  {
    readonly start: () => void;
    readonly stop: Effect.Effect<void>;
    readonly notifyRunnableJob: (name?: string) => void;
  }
>()("@monque/core/scheduler/Processing") {}

const makeProcessingLayer = ({
  collection,
  options,
  emit,
  notifyPendingJob,
  publishRouter,
}: Pick<SchedulerDependencies, "collection" | "options" | "emit"> & {
  readonly notifyPendingJob: (name: string | undefined, nextRunAt: Date) => void;
  readonly publishRouter: (router: PendingNotificationRouter) => void;
}) =>
  Layer.effect(
    Processing,
    Effect.gen(function* acquireProcessing() {
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

      const activeName = yield* ownership.findActiveInstanceJob.pipe(
        Effect.mapError((failure) => failure.cause),
      );

      yield* attempt(() => {
        if (activeName !== null) {
          throw new ConnectionError(
            `Another active Monque instance is using schedulerInstanceId "${options.schedulerInstanceId}". ` +
              `Found processing job "${activeName}" with recent heartbeat. ` +
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

      const streams = yield* makeChangeStreamHandler(
        { collection, isRunning, emit },
        notifications,
      );

      const timers = yield* makeSchedulerMaintenance({
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
      });

      const query = yield* JobQueries;
      const runSync = Effect.runSyncWith(yield* Effect.context());
      let maintenanceRun: MaintenanceRun | undefined;
      publishRouter(notifications);

      const start = () => {
        if (admission.running) {
          return;
        }

        admission.start();
        const { generation } = admission;
        const isCurrent = () => admission.running && admission.generation === generation;
        streams.setup();

        if (!isCurrent()) {
          return;
        }

        notifications.start();

        if (!isCurrent()) {
          return;
        }

        const acquiredRun = runSync(timers.start);

        if (isCurrent()) {
          maintenanceRun = acquiredRun;
        } else {
          runSync(acquiredRun.stop);
        }
      };

      const stop = Effect.gen(function* stopProcessing() {
        if (!admission.running) {
          return;
        }

        const clock = yield* Clock.Clock;

        const deadline =
          clock.monotonicTimeNanosUnsafe() + BigInt(Math.ceil(options.shutdownTimeout * 1_000_000));

        const remaining = () =>
          Math.max(0, Number(deadline - clock.monotonicTimeNanosUnsafe()) / 1_000_000);

        const capturedMaintenance = maintenanceRun;
        const { generation } = admission;
        admission.stop();
        const drain = processing.captureDrain();
        notifications.close();
        query.clearStatsCache();

        if (capturedMaintenance) {
          yield* capturedMaintenance.beginDrain(options.leaseDuration !== undefined);
        }

        yield* Effect.raceFirst(
          streams.close(() => admission.generation === generation).pipe(Effect.ignoreCause),
          Effect.suspend(() => Effect.sleep(remaining())),
        );
        const budget = remaining();

        const drained =
          budget > 0 ? yield* drain.await(budget) : drain.incompleteJobs().length === 0;

        if (capturedMaintenance) {
          yield* capturedMaintenance.stop;
        }

        if (!drained) {
          const incompleteJobs = drain.incompleteJobs();

          const error = new ShutdownTimeoutError(
            `Shutdown timed out after ${options.shutdownTimeout}ms with ${incompleteJobs.length} incomplete jobs`,
            incompleteJobs,
          );

          emit("job:error", { error });
        }
      });

      return {
        start,
        stop,
        notifyRunnableJob: (name?: string) => {
          notifications.notifyRunnableJob(name);
        },
      };
    }),
  );

/** Instance composition acquires owners without starting a processing generation. */
export const makeSchedulerLayer = (
  { collection, options, admission, emit }: SchedulerDependencies,
  persistence: Layer.Layer<JobPersistence, unknown> = makeNativeJobPersistenceLayer(collection),
  telemetryLayer = makeOperationTelemetryLayer,
) =>
  Layer.unwrap(
    Effect.gen(function* composeScheduler() {
      const telemetry = yield* OperationTelemetry;
      let router: PendingNotificationRouter | undefined;
      let ready = false;

      const notifyPendingJob = (name: string | undefined, nextRunAt: Date) => {
        if (ready && admission.running) {
          router?.notifyPendingJob(name, nextRunAt);
        }
      };

      const notifyJobFinished = (name: string) => {
        if (ready) {
          router?.notifyRunnableJob(name);
        }
      };

      return Layer.mergeAll(
        makeProcessingLayer({
          collection,
          options,
          emit,
          notifyPendingJob,
          publishRouter: (acquired) => {
            router = acquired;
          },
        }),
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
              workerObservations: (name) => admission.workerObservations(name),
            }),
          ),
        ),
        Layer.tap(() =>
          Effect.sync(() => {
            ready = true;
          }),
        ),
      );
    }),
  ).pipe(Layer.provideMerge(telemetryLayer));
