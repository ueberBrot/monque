import { DateTime, Effect } from "effect";

import { ConnectionError } from "@/shared";

import { attempt } from "../effects.js";
import { makeNativeJobOwnership } from "./job-ownership.js";
import type { JobOwnership } from "./job-ownership.js";
import type { SchedulerContext } from "./types.js";

/**
 * Temporary initialization adapter for recovery events and collision errors.
 * Database transition policy belongs exclusively to JobOwnership.
 * @internal
 */
export class JobLifecycle {
  private readonly ctx: SchedulerContext;
  private readonly ownership: JobOwnership["Service"];
  constructor(
    ctx: SchedulerContext,
    ownership: JobOwnership["Service"] = makeNativeJobOwnership(
      ctx.collection,
      ctx.instanceId,
      ctx.options,
    ),
  ) {
    this.ctx = ctx;
    this.ownership = ownership;
  }

  recoverStaleJobs = Effect.fnUntraced(function* recoverStaleClaims(this: JobLifecycle) {
    const count = yield* this.ownership.recoverStaleJobs.pipe(
      Effect.mapError((failure) => failure.cause),
    );

    if (count > 0) {
      const nextRunAt = yield* DateTime.nowAsDate;
      yield* attempt(() => {
        this.ctx.emit("stale:recovered", { count });
        this.ctx.notifyPendingJob(undefined, nextRunAt);
      });
    }
  });

  assertNoActiveInstanceCollision = Effect.fnUntraced(function* checkInstanceCollision(
    this: JobLifecycle,
  ) {
    const name = yield* this.ownership.findActiveInstanceJob.pipe(
      Effect.mapError((failure) => failure.cause),
    );

    if (name !== null) {
      return yield* Effect.fail(
        new ConnectionError(
          `Another active Monque instance is using schedulerInstanceId "${this.ctx.instanceId}". ` +
            `Found processing job "${name}" with recent heartbeat. ` +
            `Use a unique schedulerInstanceId or wait for the other instance to stop.`,
        ),
      );
    }

    return yield* Effect.void;
  });
}
