import * as Clock from "effect/Clock";
import { catch as catchFailure } from "effect/Effect";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as Scope from "effect/Scope";

import { toError } from "@/shared";

import { observeBackgroundFailure, observeTimerFailure } from "../effects.js";
import type { SchedulerContext } from "./types.js";

const makeTimers = () => {
  const scope = Scope.makeUnsafe();
  const handles = Effect.runSync(
    Effect.gen(function* createTimerHandles() {
      return {
        batch: yield* FiberHandle.make<Effect.Success<typeof Effect.void>, never>(),
        wakeup: yield* FiberHandle.make<Effect.Success<typeof Effect.void>, never>(),
        fullPoll: yield* FiberHandle.make<Effect.Success<typeof Effect.void>, never>(),
      };
    }).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  return { scope, ...handles };
};
/** Minimum poll interval floor to prevent tight loops (ms) */
const MIN_POLL_INTERVAL = 100;
/** Grace period after nextRunAt before scheduling a wakeup poll (ms) */
const POLL_GRACE_PERIOD = 200;
/** Node turns delays beyond this signed 32-bit limit into a 1 ms timer. */
const MAX_TIMER_DELAY = 2_147_483_647;
const MAX_WAKEUP_DEADLINES = 1024;
const MAX_WAKEUP_NAMES = 1024;
interface WakeupDeadline {
  time: number;
  /** Missing names require full discovery at this deadline. */
  targetNames: Set<string> | undefined;
}
/**
 * Owns Pending Notification scheduling, future wakeups, and full discovery deadlines.
 *
 * This module owns the local routing rules shared by MongoDB change streams and
 * local writes. The change stream adapter only decides when a Job became relevant.
 */
export class PendingNotificationRouter {
  /** Batch timer for immediate Pending Notifications */
  private batchPending = false;
  /** Job names collected during the current batch window for targeted polling */
  private readonly pendingTargetNames = new Set<string>();
  private fullBatchPollRequested = false;
  /** Time of the currently scheduled wakeup */
  private wakeupTime: Date | null = null;
  private readonly wakeups: WakeupDeadline[] = [];
  private wakeupNameCount = 0;
  private fullPollDueAt: bigint | null = null;
  private state = {
    changeStreamActive: false,
    started: false,
    generation: 0,
    timers: makeTimers(),
  };
  /** Start full discovery, followed by fallback or safety polling. */
  start(): void {
    const { state } = this;
    if (state.started || !this.ctx.isRunning()) {
      return;
    }
    this.state = { ...state, started: true };
    observeBackgroundFailure(this.runFork(this.pollAndScheduleNext(state.generation)));
  }
  /** Stream availability can shorten, but never postpone, full discovery. */
  setChangeStreamActive(active: boolean): void {
    this.state = { ...this.state, changeStreamActive: active };
    this.scheduleFullPoll();
  }
  private readonly ctx: SchedulerContext;
  private readonly onPoll: (targetNames?: ReadonlySet<string>) => Effect.Effect<void, unknown>;
  private readonly runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E>;
  private readonly clock: Clock.Clock;
  constructor(
    ctx: SchedulerContext,
    onPoll: (targetNames?: ReadonlySet<string>) => Effect.Effect<void, unknown>,
    runFork: <A, E>(effect: Effect.Effect<A, E>) => Fiber.Fiber<A, E> = Effect.runFork,
    clock: Clock.Clock = Effect.runSync(Clock.Clock),
  ) {
    this.ctx = ctx;
    this.onPoll = onPoll;
    this.runFork = runFork;
    this.clock = clock;
  }
  notifyPendingJob(jobName: string | undefined, nextRunAt: Date): void {
    if (!this.ctx.isRunning()) {
      return;
    }
    if (nextRunAt.getTime() > this.clock.currentTimeMillisUnsafe()) {
      this.scheduleWakeup(jobName, nextRunAt);
      return;
    }
    this.notifyRunnableJob(jobName);
  }
  notifyRunnableJob(jobName?: string): void {
    if (!this.ctx.isRunning()) {
      return;
    }
    if (jobName !== undefined && jobName) {
      this.pendingTargetNames.add(jobName);
    } else {
      this.fullBatchPollRequested = true;
    }
    this.scheduleBatchPoll();
  }
  close(): void {
    const { state } = this;
    this.state = {
      ...state,
      started: false,
      generation: state.generation + 1,
      timers: makeTimers(),
    };
    this.fullPollDueAt = null;
    this.batchPending = false;
    this.wakeupTime = null;
    this.runFork(Scope.close(state.timers.scope, Exit.void));
    this.pendingTargetNames.clear();
    this.fullBatchPollRequested = false;
    this.wakeups.length = 0;
    this.wakeupNameCount = 0;
  }
  /**
   * Schedule a poll at the end of a fixed batch window with collected target names.
   *
   * Collects Job Names from multiple Pending Notifications during the batch
   * window, then triggers a single targeted poll for only those Workers.
   */
  private scheduleBatchPoll(): void {
    if (this.batchPending) {
      return;
    }
    this.batchPending = true;
    const { state } = this;
    const fiber = this.runFork(
      Effect.gen({ self: this }, function* flushPendingBatch() {
        yield* Effect.sleep(MIN_POLL_INTERVAL);
        if (state.generation !== this.state.generation) {
          return;
        }
        this.batchPending = false;
        const names = this.fullBatchPollRequested ? undefined : new Set(this.pendingTargetNames);
        this.pendingTargetNames.clear();
        this.fullBatchPollRequested = false;
        observeBackgroundFailure(this.runFork(this.poll(names)));
      }),
    );
    FiberHandle.setUnsafe(state.timers.batch, fiber);
    observeTimerFailure(fiber);
  }
  /**
   * Schedule a wakeup timer for a future-dated Job.
   *
   * Maintains a single timer set to the earliest known future Job's `nextRunAt`.
   * When the timer fires, checks the names associated with all due deadlines.
   * Unknown names or exhausted name tracking request full discovery instead.
   */
  private scheduleWakeup(jobName: string | undefined, nextRunAt: Date): void {
    const time = nextRunAt.getTime();
    const latestDeadline = this.wakeups[MAX_WAKEUP_DEADLINES - 1];
    if (
      latestDeadline !== undefined &&
      this.wakeups.length === MAX_WAKEUP_DEADLINES &&
      time > latestDeadline.time
    ) {
      return;
    }
    const index = this.wakeups.findIndex((deadline) => deadline.time >= time);
    let deadline = index === -1 ? undefined : this.wakeups[index];
    if (deadline?.time !== time) {
      deadline = { time, targetNames: new Set() };
      if (index === -1) {
        this.wakeups.push(deadline);
      } else {
        this.wakeups.splice(index, 0, deadline);
      }
      if (this.wakeups.length > MAX_WAKEUP_DEADLINES) {
        this.wakeupNameCount -= this.wakeups.pop()?.targetNames?.size ?? 0;
      }
    }
    if (deadline.targetNames && !deadline.targetNames.has(jobName ?? "")) {
      if (jobName === undefined || !jobName || this.wakeupNameCount === MAX_WAKEUP_NAMES) {
        this.wakeupNameCount -= deadline.targetNames.size;
        deadline.targetNames = undefined;
      } else {
        deadline.targetNames.add(jobName);
        this.wakeupNameCount += 1;
      }
    }
    if (this.wakeupTime && nextRunAt >= this.wakeupTime) {
      return;
    }
    this.armWakeup();
  }
  private armWakeup(): void {
    this.clearWakeupTimer();
    const [headDeadline] = this.wakeups;
    if (headDeadline === undefined) {
      return;
    }
    const nextRunAt = new Date(headDeadline.time);
    this.wakeupTime = nextRunAt;
    const delay = Math.max(
      nextRunAt.getTime() - this.clock.currentTimeMillisUnsafe() + POLL_GRACE_PERIOD,
      MIN_POLL_INTERVAL,
    );
    const { state } = this;
    const fiber = this.runFork(
      Effect.gen({ self: this }, function* wakePendingNames() {
        yield* Effect.sleep(Math.min(delay, MAX_TIMER_DELAY));
        if (state.generation !== this.state.generation) {
          return;
        }
        this.wakeupTime = null;
        if (delay > MAX_TIMER_DELAY) {
          this.armWakeup();
          return;
        }
        const now = yield* Clock.currentTimeMillis;
        const names = new Set<string>();
        let fullPoll = false;
        let [dueDeadline] = this.wakeups;
        while (dueDeadline !== undefined && dueDeadline.time <= now) {
          const deadline = dueDeadline;
          this.wakeups.shift();
          this.wakeupNameCount -= deadline.targetNames?.size ?? 0;
          if (deadline.targetNames) {
            for (const name of deadline.targetNames) {
              names.add(name);
            }
          } else {
            fullPoll = true;
          }
          [dueDeadline] = this.wakeups;
        }
        if (this.wakeups.length > 0) {
          this.armWakeup();
        }
        observeBackgroundFailure(this.runFork(fullPoll ? this.poll() : this.poll(names)));
      }),
    );
    FiberHandle.setUnsafe(state.timers.wakeup, fiber);
    observeTimerFailure(fiber);
  }
  private pollAndScheduleNext(generation: number): Effect.Effect<void> {
    return this.poll().pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (generation === this.state.generation) {
            this.scheduleFullPoll();
          }
        }),
      ),
    );
  }
  private poll(...args: [] | [ReadonlySet<string> | undefined]): Effect.Effect<void> {
    return Effect.suspend(() => this.onPoll(...args)).pipe(
      catchFailure((failure) =>
        Effect.sync(() => {
          this.ctx.emit("job:error", { error: toError(failure) });
        }),
      ),
    );
  }
  private scheduleFullPoll(): void {
    const { state } = this;
    if (!state.started || !this.ctx.isRunning()) {
      return;
    }
    const interval = state.changeStreamActive
      ? this.ctx.options.safetyPollInterval
      : this.ctx.options.pollInterval;
    const dueAt = this.clock.monotonicTimeNanosUnsafe() + BigInt(Math.ceil(interval * 1_000_000));
    if (this.fullPollDueAt !== null && this.fullPollDueAt <= dueAt) {
      return;
    }
    this.fullPollDueAt = dueAt;
    this.armFullPoll();
  }
  private armFullPoll(): void {
    if (this.fullPollDueAt === null) {
      return;
    }
    const delay = Number(this.fullPollDueAt - this.clock.monotonicTimeNanosUnsafe()) / 1_000_000;
    const { state } = this;
    const fiber = this.runFork(
      Effect.gen({ self: this }, function* runSafetyPoll() {
        yield* Effect.sleep(Math.min(delay, MAX_TIMER_DELAY));
        if (state.generation !== this.state.generation) {
          return;
        }
        if (this.fullPollDueAt !== null && this.fullPollDueAt > (yield* Clock.monotonicTimeNanos)) {
          this.armFullPoll();
          return;
        }
        this.fullPollDueAt = null;
        observeBackgroundFailure(this.runFork(this.pollAndScheduleNext(state.generation)));
      }),
    );
    FiberHandle.setUnsafe(state.timers.fullPoll, fiber);
    observeTimerFailure(fiber);
  }
  private clearWakeupTimer(): void {
    this.runFork(FiberHandle.clear(this.state.timers.wakeup));
    this.wakeupTime = null;
  }
}
