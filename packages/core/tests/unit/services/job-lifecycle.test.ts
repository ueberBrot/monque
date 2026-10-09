import { it } from "@effect/vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { Effect } from "effect";
import { beforeEach, describe, expect, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { JobLifecycle } from "@/scheduler/services/job-lifecycle.js";
import { ConnectionError } from "@/shared";
import { createMockContext, JobFactory, JobFactoryHelpers } from "@tests/factories";
import { anyMatcher, objectContainingMatcher } from "@tests/setup/matchers.js";

describe(JobLifecycle, () => {
  let ctx: ReturnType<typeof createMockContext>;
  let lifecycle: JobLifecycle;
  beforeEach(() => {
    ctx = createMockContext();
    lifecycle = new JobLifecycle(ctx);
  });
  describe("claimNext acquisition", () => {
    it.effect("claims the highest-priority due pending job for this scheduler instance", () =>
      Effect.gen(function* effectWorkflow1() {
        const pendingJob = JobFactory.build({ name: "email" });
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(pendingJob);
        const job = yield* lifecycle.claimNext("email");
        expect(job?.name).toBe("email");
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
          objectContainingMatcher({
            name: "email",
            status: JobStatus.PENDING,
            nextRunAt: { $lte: anyMatcher(Date) },
          }),
          objectContainingMatcher({
            $set: objectContainingMatcher({
              status: JobStatus.PROCESSING,
              claimedBy: "test-instance-id",
              lockedAt: anyMatcher(Date),
              lastHeartbeat: anyMatcher(Date),
              heartbeatInterval: ctx.options.heartbeatInterval,
            }),
          }),
          {
            sort: { priority: -1, nextRunAt: 1, _id: 1 },
            returnDocument: "after",
          },
        );
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalledWith(
          objectContainingMatcher({ $or: anyMatcher(Array) }),
          anyMatcher(Object),
          anyMatcher(Object),
        );
      }),
    );
  });
  describe("completeOwned ownership", () => {
    it.effect("returns null and skips notification when recurring completion loses ownership", () =>
      Effect.gen(function* effectWorkflow2() {
        const job = JobFactoryHelpers.processing({
          repeatInterval: "0 * * * *",
        });
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        const result = yield* lifecycle.completeOwned(job);
        expect({
          result,
          notifyPendingJobMockCallsLength: ctx.notifyPendingJob.mock.calls.length,
        }).toStrictEqual({
          result: null,
          notifyPendingJobMockCallsLength: 0,
        });
      }),
    );
  });
  describe("recoverStaleJobs", () => {
    it.effect("resets stale processing jobs to pending and emits the recovered count", () =>
      Effect.gen(function* effectWorkflow3() {
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 2,
          modifiedCount: 2,
          upsertedCount: 0,
          upsertedId: null,
        });
        yield* lifecycle.recoverStaleJobs();
        expect(ctx.emitHistory).toContainEqual({
          event: "stale:recovered",
          payload: { count: 2 },
        });
      }),
    );
  });
  describe("assertNoActiveInstanceCollision", () => {
    it.effect(
      "throws when another processing job has this scheduler id and a recent heartbeat",
      () =>
        Effect.gen(function* effectWorkflow4() {
          const activeJob = JobFactory.build({
            name: "email",
            status: JobStatus.PROCESSING,
            claimedBy: "test-instance-id",
            lastHeartbeat: new Date(),
          });
          vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(activeJob);
          const error = yield* Effect.flip(lifecycle.assertNoActiveInstanceCollision());
          expect(error).toBeInstanceOf(ConnectionError);
          expect(ctx.mockCollection.findOne).toHaveBeenCalledWith({
            claimedBy: "test-instance-id",
            status: JobStatus.PROCESSING,
            lastHeartbeat: { $gte: anyMatcher(Date) },
          });
        }),
    );
  });
  describe("claimNext", () => {
    it.effect("should return null if scheduler is not running", () =>
      Effect.gen(function* effectWorkflow5() {
        vi.spyOn(ctx, "isRunning").mockReturnValue(false);
        const job = yield* lifecycle.claimNext("test-job");
        expect({
          job,
          mockCollectionFindOneAndUpdateMockCallsLength:
            ctx.mockCollection.findOneAndUpdate.mock.calls.length,
        }).toStrictEqual({
          job: null,
          mockCollectionFindOneAndUpdateMockCallsLength: 0,
        });
      }),
    );
    it.effect("should return null when no jobs available", () =>
      Effect.gen(function* effectWorkflow6() {
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        const job = yield* lifecycle.claimNext("test-job");
        expect(job).toBeNull();
      }),
    );
  });
  describe("completeOwned", () => {
    it.effect("should atomically mark one-time job as completed", () =>
      Effect.gen(function* effectWorkflow7() {
        const job = JobFactoryHelpers.processing();
        const completedJob = JobFactoryHelpers.completed({
          _id: job._id,
          name: job.name,
          data: job.data,
        });
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(completedJob);
        const result = yield* lifecycle.completeOwned(job);
        expect(result).not.toBeNull();
        expect({
          resultStatus: result?.status,
          notifyPendingJobMockCallsLength: ctx.notifyPendingJob.mock.calls.length,
        }).toStrictEqual({
          resultStatus: JobStatus.COMPLETED,
          notifyPendingJobMockCallsLength: 0,
        });
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: job._id,
            status: JobStatus.PROCESSING,
            claimedBy: "test-instance-id",
            claimId: null,
          },
          objectContainingMatcher({
            $set: objectContainingMatcher({ status: JobStatus.COMPLETED }),
          }),
          { returnDocument: "after" },
        );
      }),
    );
    it.effect("should atomically reschedule recurring job with next cron date", () =>
      Effect.gen(function* effectWorkflow8() {
        const job = JobFactoryHelpers.processing({ repeatInterval: "0 * * * *" });
        const rescheduledJob = JobFactoryHelpers.pending({
          _id: job._id,
          name: job.name,
          data: job.data,
          repeatInterval: "0 * * * *",
          failCount: 0,
        });
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(rescheduledJob);
        const result = yield* lifecycle.completeOwned(job);
        expect(result).not.toBeNull();
        expect(result?.status).toBe(JobStatus.PENDING);
        expect(ctx.notifyPendingJob).toHaveBeenCalledWith(
          rescheduledJob.name,
          rescheduledJob.nextRunAt,
        );
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: job._id,
            status: JobStatus.PROCESSING,
            claimedBy: "test-instance-id",
            claimId: null,
          },
          objectContainingMatcher({
            $set: objectContainingMatcher({ status: JobStatus.PENDING, failCount: 0 }),
          }),
          { returnDocument: "after" },
        );
      }),
    );
    it.effect("should return null when job is no longer in PROCESSING state", () =>
      Effect.gen(function* effectWorkflow9() {
        const job = JobFactoryHelpers.processing();
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        const result = yield* lifecycle.completeOwned(job);
        expect(result).toBeNull();
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: job._id,
            status: JobStatus.PROCESSING,
            claimedBy: "test-instance-id",
            claimId: null,
          },
          anyMatcher(Object),
          { returnDocument: "after" },
        );
      }),
    );
    it.effect("should return null for non-persisted jobs (no _id)", () =>
      Effect.gen(function* effectWorkflow10() {
        const { _id: _, ...jobWithoutId } = JobFactory.build();
        const nonPersistedJob = fromAny<Parameters<typeof lifecycle.completeOwned>[0], unknown>(
          jobWithoutId,
        );
        const result = yield* lifecycle.completeOwned(nonPersistedJob);
        expect({
          result,
          mockCollectionFindOneAndUpdateMockCallsLength:
            ctx.mockCollection.findOneAndUpdate.mock.calls.length,
        }).toStrictEqual({
          result: null,
          mockCollectionFindOneAndUpdateMockCallsLength: 0,
        });
      }),
    );
  });
  describe("failOwned", () => {
    it.effect("should atomically schedule retry with increased failCount when retries remain", () =>
      Effect.gen(function* effectWorkflow11() {
        const job = JobFactoryHelpers.processing({ failCount: 0 });
        const retriedJob = JobFactoryHelpers.pending({
          _id: job._id,
          name: job.name,
          data: job.data,
          failCount: 1,
          failReason: "Test failure",
        });
        const error = new Error("Test failure");
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(retriedJob);
        const result = yield* lifecycle.failOwned(job, error);
        expect(result).not.toBeNull();
        expect({
          resultStatus: result?.status,
          resultFailCount: result?.failCount,
        }).toStrictEqual({
          resultStatus: JobStatus.PENDING,
          resultFailCount: 1,
        });
        expect(ctx.notifyPendingJob).toHaveBeenCalledExactlyOnceWith(
          retriedJob.name,
          retriedJob.nextRunAt,
        );
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: job._id,
            status: JobStatus.PROCESSING,
            claimedBy: "test-instance-id",
            claimId: null,
          },
          objectContainingMatcher({
            $set: objectContainingMatcher({
              status: JobStatus.PENDING,
              failCount: 1,
              failReason: "Test failure",
            }),
          }),
          { returnDocument: "after" },
        );
      }),
    );
    it.effect("should atomically mark job as failed when max retries exceeded", () =>
      Effect.gen(function* effectWorkflow12() {
        const job = JobFactoryHelpers.processing({ failCount: 2 });
        const failedJob = JobFactoryHelpers.failed({
          _id: job._id,
          name: job.name,
          data: job.data,
          failCount: 3,
          failReason: "Final failure",
        });
        const error = new Error("Final failure");
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(failedJob);
        const result = yield* lifecycle.failOwned(job, error);
        expect(result).not.toBeNull();
        expect({
          resultStatus: result?.status,
          resultFailCount: result?.failCount,
          notifyPendingJobMockCallsLength: ctx.notifyPendingJob.mock.calls.length,
        }).toStrictEqual({
          resultStatus: JobStatus.FAILED,
          resultFailCount: 3,
          notifyPendingJobMockCallsLength: 0,
        });
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: job._id,
            status: JobStatus.PROCESSING,
            claimedBy: "test-instance-id",
            claimId: null,
          },
          objectContainingMatcher({
            $set: objectContainingMatcher({
              status: JobStatus.FAILED,
              failCount: 3,
              failReason: "Final failure",
            }),
          }),
          { returnDocument: "after" },
        );
      }),
    );
    it.effect("should return null when job is no longer in PROCESSING state", () =>
      Effect.gen(function* effectWorkflow13() {
        const job = JobFactoryHelpers.processing({ failCount: 0 });
        const error = new Error("Test failure");
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        const result = yield* lifecycle.failOwned(job, error);
        expect({
          result,
          notifyPendingJobMockCallsLength: ctx.notifyPendingJob.mock.calls.length,
        }).toStrictEqual({
          result: null,
          notifyPendingJobMockCallsLength: 0,
        });
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
          {
            _id: job._id,
            status: JobStatus.PROCESSING,
            claimedBy: "test-instance-id",
            claimId: null,
          },
          anyMatcher(Object),
          { returnDocument: "after" },
        );
      }),
    );
    it.effect("should return null for non-persisted jobs (no _id)", () =>
      Effect.gen(function* effectWorkflow14() {
        const { _id: _, ...jobWithoutId } = JobFactory.build();
        const nonPersistedJob = fromAny<Parameters<typeof lifecycle.failOwned>[0], unknown>(
          jobWithoutId,
        );
        const error = new Error("Test error");
        const result = yield* lifecycle.failOwned(nonPersistedJob, error);
        expect({
          result,
          notifyPendingJobMockCallsLength: ctx.notifyPendingJob.mock.calls.length,
          mockCollectionFindOneAndUpdateMockCallsLength:
            ctx.mockCollection.findOneAndUpdate.mock.calls.length,
        }).toStrictEqual({
          result: null,
          notifyPendingJobMockCallsLength: 0,
          mockCollectionFindOneAndUpdateMockCallsLength: 0,
        });
      }),
    );
  });
  describe("updateOwnedHeartbeats", () => {
    it.effect("skips heartbeat writes when no claims are active", () =>
      Effect.gen(function* effectWorkflow15() {
        yield* lifecycle.updateOwnedHeartbeats();
        expect(ctx.mockCollection.updateMany).not.toHaveBeenCalled();
      }),
    );
  });
});
