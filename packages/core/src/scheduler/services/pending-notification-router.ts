import { toError } from "@/shared";

import type { SchedulerContext } from "./types.js";

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
  private batchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Job names collected during the current batch window for targeted polling */
  private pendingTargetNames: Set<string> = new Set();
  private fullBatchPollRequested = false;

  /** Wakeup timer for the earliest known future Job */
  private wakeupTimer: ReturnType<typeof setTimeout> | null = null;

  /** Time of the currently scheduled wakeup */
  private wakeupTime: Date | null = null;
  private readonly wakeups: WakeupDeadline[] = [];
  private wakeupNameCount = 0;

  private fullPollTimer: ReturnType<typeof setTimeout> | null = null;
  private fullPollDueAt: number | null = null;
  private changeStreamActive = false;
  private started = false;
  private generation = 0;

  /** Start full discovery, followed by fallback or safety polling. */
  start(): void {
    if (this.started || !this.ctx.isRunning()) return;
    this.started = true;
    void this.pollAndScheduleNext(this.generation);
  }

  /** Stream availability can shorten, but never postpone, full discovery. */
  setChangeStreamActive(active: boolean): void {
    this.changeStreamActive = active;
    this.scheduleFullPoll();
  }

  constructor(
    private readonly ctx: SchedulerContext,
    private readonly onPoll: (targetNames?: ReadonlySet<string>) => Promise<void>,
  ) {}

  notifyPendingJob(jobName: string | undefined, nextRunAt: Date): void {
    if (!this.ctx.isRunning()) {
      return;
    }

    if (nextRunAt.getTime() > Date.now()) {
      this.scheduleWakeup(jobName, nextRunAt);
      return;
    }

    this.notifyRunnableJob(jobName);
  }

  notifyRunnableJob(jobName?: string): void {
    if (!this.ctx.isRunning()) {
      return;
    }

    if (jobName) {
      this.pendingTargetNames.add(jobName);
    } else {
      this.fullBatchPollRequested = true;
    }

    this.scheduleBatchPoll();
  }

  close(): void {
    this.started = false;
    this.generation++;
    this.fullPollDueAt = null;
    if (this.fullPollTimer) {
      clearTimeout(this.fullPollTimer);
      this.fullPollTimer = null;
    }
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    this.pendingTargetNames.clear();
    this.fullBatchPollRequested = false;
    this.wakeups.length = 0;
    this.wakeupNameCount = 0;
    this.clearWakeupTimer();
  }

  /**
   * Schedule a poll at the end of a fixed batch window with collected target names.
   *
   * Collects Job Names from multiple Pending Notifications during the batch
   * window, then triggers a single targeted poll for only those Workers.
   */
  private scheduleBatchPoll(): void {
    if (this.batchTimer) {
      return;
    }

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      const names = this.fullBatchPollRequested ? undefined : new Set(this.pendingTargetNames);
      this.pendingTargetNames.clear();
      this.fullBatchPollRequested = false;
      this.onPoll(names).catch((error: unknown) => {
        this.ctx.emit("job:error", { error: toError(error) });
      });
    }, 100);
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
    if (
      this.wakeups.length === MAX_WAKEUP_DEADLINES &&
      time > this.wakeups[MAX_WAKEUP_DEADLINES - 1]!.time
    ) {
      return;
    }
    const index = this.wakeups.findIndex((deadline) => deadline.time >= time);
    let deadline = index === -1 ? undefined : this.wakeups[index];
    if (deadline?.time !== time) {
      deadline = { time, targetNames: new Set() };
      if (index === -1) this.wakeups.push(deadline);
      else this.wakeups.splice(index, 0, deadline);
      if (this.wakeups.length > MAX_WAKEUP_DEADLINES) {
        this.wakeupNameCount -= this.wakeups.pop()!.targetNames?.size ?? 0;
      }
    }
    if (deadline.targetNames && !deadline.targetNames.has(jobName ?? "")) {
      if (!jobName || this.wakeupNameCount === MAX_WAKEUP_NAMES) {
        this.wakeupNameCount -= deadline.targetNames.size;
        deadline.targetNames = undefined;
      } else {
        deadline.targetNames.add(jobName);
        this.wakeupNameCount++;
      }
    }
    if (this.wakeupTime && nextRunAt >= this.wakeupTime) {
      return;
    }

    this.armWakeup();
  }

  private armWakeup(): void {
    this.clearWakeupTimer();
    const nextRunAt = new Date(this.wakeups[0]!.time);
    this.wakeupTime = nextRunAt;

    const delay = Math.max(nextRunAt.getTime() - Date.now() + POLL_GRACE_PERIOD, MIN_POLL_INTERVAL);

    this.wakeupTimer = setTimeout(
      () => {
        this.wakeupTime = null;
        this.wakeupTimer = null;
        if (delay > MAX_TIMER_DELAY) {
          this.armWakeup();
          return;
        }
        const now = Date.now();
        const names = new Set<string>();
        let fullPoll = false;
        while (this.wakeups.length > 0 && this.wakeups[0]!.time <= now) {
          const deadline = this.wakeups.shift()!;
          this.wakeupNameCount -= deadline.targetNames?.size ?? 0;
          if (!deadline.targetNames) fullPoll = true;
          else for (const name of deadline.targetNames) names.add(name);
        }
        if (this.wakeups.length > 0) this.armWakeup();
        const poll = fullPoll ? this.onPoll() : this.onPoll(names);
        poll.catch((error: unknown) => {
          this.ctx.emit("job:error", { error: toError(error) });
        });
      },
      Math.min(delay, MAX_TIMER_DELAY),
    );
  }

  private async pollAndScheduleNext(generation: number): Promise<void> {
    try {
      await this.onPoll();
    } catch (error) {
      this.ctx.emit("job:error", { error: toError(error) });
    } finally {
      if (generation === this.generation) this.scheduleFullPoll();
    }
  }

  private scheduleFullPoll(): void {
    if (!this.started || !this.ctx.isRunning()) return;

    const interval = this.changeStreamActive
      ? this.ctx.options.safetyPollInterval
      : this.ctx.options.pollInterval;
    const dueAt = Date.now() + interval;
    if (this.fullPollDueAt !== null && this.fullPollDueAt <= dueAt) return;
    if (this.fullPollTimer) clearTimeout(this.fullPollTimer);
    this.fullPollDueAt = dueAt;
    this.armFullPoll();
  }

  private armFullPoll(): void {
    if (this.fullPollDueAt === null) return;
    const delay = this.fullPollDueAt - Date.now();
    this.fullPollTimer = setTimeout(
      () => {
        this.fullPollTimer = null;
        if (this.fullPollDueAt !== null && this.fullPollDueAt > Date.now()) {
          this.armFullPoll();
          return;
        }
        this.fullPollDueAt = null;
        void this.pollAndScheduleNext(this.generation);
      },
      Math.min(delay, MAX_TIMER_DELAY),
    );
  }

  private clearWakeupTimer(): void {
    if (this.wakeupTimer) {
      clearTimeout(this.wakeupTimer);
      this.wakeupTimer = null;
    }
    this.wakeupTime = null;
  }
}
