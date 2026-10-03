import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import { ChangeStreamHandler } from "./services/change-stream-handler.js";
import { JobIntake } from "./services/job-intake.js";
import { JobLifecycle } from "./services/job-lifecycle.js";
import { JobManager } from "./services/job-manager.js";
import { JobProcessor } from "./services/job-processor.js";
import { JobQueryService } from "./services/job-query.js";
import { LifecycleManager } from "./services/lifecycle-manager.js";
import { PendingNotificationRouter } from "./services/pending-notification-router.js";
import type { SchedulerContext } from "./services/types.js";

type SchedulerExecution = {
  readonly runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>;
};

export class SchedulerServices extends Context.Service<
  SchedulerServices,
  {
    readonly intake: JobIntake;
    readonly manager: JobManager;
    readonly queries: JobQueryService;
    readonly notifications: PendingNotificationRouter;
    readonly streams: ChangeStreamHandler;
    readonly timers: LifecycleManager;
  }
>()("@monque/core/scheduler/Services") {}

export function makeSchedulerLayer(
  environment: SchedulerContext,
  execution: SchedulerExecution,
): Layer.Layer<SchedulerServices, unknown> {
  return Layer.effect(
    SchedulerServices,
    Effect.gen(function* () {
      const lifecycle = new JobLifecycle(environment);
      if (environment.options.recoverStaleJobs) yield* lifecycle.recoverStaleJobs();
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
        queries: new JobQueryService(environment),
        notifications,
        streams: new ChangeStreamHandler(environment, notifications, execution.runFork),
        timers: new LifecycleManager(environment, lifecycle, execution.runFork),
      };
    }),
  );
}
