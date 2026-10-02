import { JobStatus } from "@/jobs";
import { toError } from "@/shared";

import type { SchedulerContext } from "./types.js";

const DISCOVERY_READ_OPTIONS = {
  readPreference: "primary",
  readConcern: { level: "local" },
} as const;

type DiscoveryContext = Pick<SchedulerContext, "collection" | "emit" | "notifyPendingJob">;

/**
 * Owns pending Job discovery and persisted deadline notifications.
 *
 * Keeps collation eligibility, read consistency, and discovery fallback local;
 * the processor only needs to know which Job Names can be claimed now.
 *
 * @internal Not part of public API.
 */
export class JobDiscovery {
  private binaryNameMatching: boolean | undefined;

  constructor(private readonly ctx: DiscoveryContext) {}

  /** Resolve notification names or read the earliest pending deadline per eligible Job Name. */
  async discoverDue(
    names: ReadonlySet<string>,
    targetNames?: ReadonlySet<string>,
  ): Promise<ReadonlySet<string>> {
    // Notification and grouped names only match registered names under binary comparison.
    // Other collations retain the database's matching semantics through atomic claims.
    if (!(await this.usesBinaryNameMatching())) return names;
    if (targetNames) return new Set([...names].filter((name) => targetNames.has(name)));

    try {
      const pending = await this.ctx.collection
        .aggregate<{ _id: string; nextRunAt: Date }>(
          [
            { $match: { name: { $in: [...names] }, status: JobStatus.PENDING } },
            { $sort: { name: 1, nextRunAt: 1 } },
            { $group: { _id: "$name", nextRunAt: { $first: "$nextRunAt" } } },
          ],
          DISCOVERY_READ_OPTIONS,
        )
        .toArray();
      const dueNames = new Set<string>();
      const now = Date.now();
      for (const job of pending) {
        if (job.nextRunAt.getTime() <= now) dueNames.add(job._id);
        else this.ctx.notifyPendingJob(job._id, job.nextRunAt);
      }
      return dueNames;
    } catch (error) {
      // Discovery is an optimization; atomic claims remain the fallback on read failure.
      this.ctx.emit("job:error", { error: toError(error) });
      return names;
    }
  }

  /** Cache whether notification and grouped names can match registered names exactly. */
  private async usesBinaryNameMatching(): Promise<boolean> {
    if (this.binaryNameMatching !== undefined) return this.binaryNameMatching;

    try {
      const { collation } = await this.ctx.collection.options({ readPreference: "primary" });
      this.binaryNameMatching = !collation || collation["locale"] === "simple";
    } catch (error) {
      // Metadata access is optional; retain database matching without retrying every poll.
      this.binaryNameMatching = false;
      this.ctx.emit("job:error", { error: toError(error) });
    }
    return this.binaryNameMatching;
  }

  /** An empty claim can hide a persisted future Job behind work acquired elsewhere. */
  async notifyNextRun(name: string): Promise<void> {
    try {
      const job = await this.ctx.collection.findOne<{ nextRunAt: Date }>(
        { name, status: JobStatus.PENDING },
        {
          ...DISCOVERY_READ_OPTIONS,
          projection: { _id: 0, nextRunAt: 1 },
          sort: { nextRunAt: 1 },
        },
      );
      if (job) this.ctx.notifyPendingJob(name, job.nextRunAt);
    } catch (error) {
      this.ctx.emit("job:error", { error: toError(error) });
    }
  }
}
