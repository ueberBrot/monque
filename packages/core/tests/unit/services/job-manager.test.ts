import { it } from "@effect/vitest";
import { Effect, Result } from "effect";
/**
 * Unit tests for JobManager service.
 *
 * Tests job management operations: cancel, retry, reschedule, delete.
 * Uses mock SchedulerContext to test state transition logic in isolation.
 */
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { JobManager } from "@/scheduler/services/job-manager.js";
import { ConnectionError, JobStateError } from "@/shared";
import { createMockContext, JobFactory, JobFactoryHelpers } from "@tests/factories";

describe("JobManager", () => {
  let ctx: ReturnType<typeof createMockContext>;
  let manager: JobManager;

  beforeEach(() => {
    ctx = createMockContext();
    manager = new JobManager(ctx);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("cancelJob", () => {
    it.effect("should cancel a pending job", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const cancelledJob = JobFactoryHelpers.cancelled({ _id: jobId, name: "cancel-test" });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(cancelledJob);

        const job = yield* manager.cancelJob(jobId.toString());

        expect(job).not.toBeNull();
        expect(job?.status).toBe(JobStatus.CANCELLED);
        expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:cancelled" }));
      }),
    );

    it.effect("should return null for non-existent job", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(null);

        const job = yield* manager.cancelJob(new ObjectId().toString());

        expect(job).toBeNull();
      }),
    );

    it.effect("should throw JobStateError when cancelling a processing job", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const processingJob = JobFactoryHelpers.processing({ _id: jobId });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(processingJob);

        expect(yield* Effect.result(manager.cancelJob(jobId.toString()))).toMatchObject({
          _tag: "Failure",
          failure: expect.any(JobStateError),
        });
      }),
    );

    it.effect("should return existing job if already cancelled", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const cancelledJob = JobFactoryHelpers.cancelled({ _id: jobId });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(cancelledJob);

        const job = yield* manager.cancelJob(jobId.toString());

        expect(job?.status).toBe(JobStatus.CANCELLED);
        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalled();
        expect(ctx.emitHistory).not.toContainEqual(
          expect.objectContaining({ event: "job:cancelled" }),
        );
      }),
    );
  });

  describe("retryJob", () => {
    it.effect("should retry a failed job", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const previousRunAt = new Date("2025-01-01T00:00:00.000Z");
        const failedJob = Object.freeze(
          JobFactoryHelpers.failed({
            _id: jobId,
            nextRunAt: previousRunAt,
            updatedAt: previousRunAt,
            lockedAt: previousRunAt,
            claimedBy: "previous-instance",
            claimId: "previous-claim",
            leaseExpiresAt: previousRunAt,
            lastHeartbeat: previousRunAt,
          }),
        );
        const originalJob = { ...failedJob };

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(failedJob);
        const expectedUnset = {
          failReason: "",
          lockedAt: "",
          claimedBy: "",
          claimId: "",
          leaseExpiresAt: "",
          lastHeartbeat: "",
        };

        const job = yield* manager.retryJob(jobId.toString());

        expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ _id: jobId }),
          {
            $set: {
              status: JobStatus.PENDING,
              failCount: 0,
              nextRunAt: job?.nextRunAt,
              updatedAt: job?.updatedAt,
            },
            $unset: expectedUnset,
          },
          expect.objectContaining({ returnDocument: "before" }),
        );

        expect(job?.status).toBe(JobStatus.PENDING);
        expect(job?.failCount).toBe(0);
        expect(job?.nextRunAt).toBeInstanceOf(Date);
        expect(job?.nextRunAt).not.toEqual(previousRunAt);
        expect(job?.updatedAt).toEqual(job?.nextRunAt);
        for (const field of Object.keys(expectedUnset)) {
          expect(job).not.toHaveProperty(field);
        }
        expect(ctx.notifyPendingJob).toHaveBeenCalledWith(failedJob.name, job?.nextRunAt);
        expect(ctx.emitHistory).toContainEqual({
          event: "job:retried",
          payload: { job, previousStatus: JobStatus.FAILED },
        });
        expect(failedJob).toEqual(originalJob);
      }),
    );

    it.effect("should retry a cancelled job", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const cancelledJob = JobFactoryHelpers.cancelled({ _id: jobId });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(cancelledJob);

        const job = yield* manager.retryJob(jobId.toString());

        expect(job?.status).toBe(JobStatus.PENDING);
      }),
    );

    it.effect("should throw JobStateError when retrying a pending job", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const pendingJob = JobFactory.build({ _id: jobId });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(pendingJob);

        expect(yield* Effect.result(manager.retryJob(jobId.toString()))).toMatchObject({
          _tag: "Failure",
          failure: expect.any(JobStateError),
        });
      }),
    );

    it.effect("should return null for non-existent job", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(null);

        const job = yield* manager.retryJob(new ObjectId().toString());

        expect(job).toBeNull();
      }),
    );
  });

  describe("rescheduleJob", () => {
    it.effect("should reschedule a pending job to new time", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const newRunAt = new Date(Date.now() + 3600000);
        const rescheduledJob = JobFactory.build({ _id: jobId, nextRunAt: newRunAt });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(rescheduledJob);

        const job = yield* manager.rescheduleJob(jobId.toString(), newRunAt);

        expect(job?.nextRunAt).toEqual(newRunAt);
        expect(ctx.notifyPendingJob).toHaveBeenCalledWith(rescheduledJob.name, newRunAt);
      }),
    );

    it.effect("should throw JobStateError when rescheduling a processing job", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const processingJob = JobFactoryHelpers.processing({ _id: jobId });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(processingJob);

        expect(
          yield* Effect.result(manager.rescheduleJob(jobId.toString(), new Date())),
        ).toMatchObject({ _tag: "Failure", failure: expect.any(JobStateError) });
      }),
    );

    it.effect("should return null for non-existent job", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(null);

        const job = yield* manager.rescheduleJob(new ObjectId().toString(), new Date());

        expect(job).toBeNull();
      }),
    );
  });

  describe("cancelJob - race conditions", () => {
    it.effect("should throw JobStateError when job status changes during cancellation", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const processingJob = JobFactoryHelpers.processing({ _id: jobId });

        // findOneAndUpdate returns null (another process changed the status)
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        // Fallback findOne returns the changed job
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(processingJob);

        const failureResult1 = yield* Effect.result(manager.cancelJob(jobId.toString()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(JobStateError);
        expect((error as JobStateError).message).toMatch(
          /Cannot cancel job in status 'processing'/,
        );
      }),
    );
  });

  describe("retryJob - race conditions", () => {
    it.effect("should throw JobStateError when job status changes during retry", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const processingJob = JobFactoryHelpers.processing({ _id: jobId });

        // findOneAndUpdate returns null (another process changed the status)
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        // Fallback findOne returns changed job
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(processingJob);

        const failureResult1 = yield* Effect.result(manager.retryJob(jobId.toString()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(JobStateError);
        expect((error as JobStateError).message).toMatch(/Cannot retry job in status 'processing'/);
      }),
    );
  });

  describe("rescheduleJob - race conditions", () => {
    it.effect("should throw JobStateError when job status changes during reschedule", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const newRunAt = new Date(Date.now() + 3600000);
        const processingJob = JobFactoryHelpers.processing({ _id: jobId });

        // findOneAndUpdate returns null (another process changed the status)
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        // Fallback findOne returns changed job
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(processingJob);

        const failureResult1 = yield* Effect.result(
          manager.rescheduleJob(jobId.toString(), newRunAt),
        );
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(JobStateError);
        expect((error as JobStateError).message).toMatch(
          /Cannot reschedule job in status 'processing'/,
        );
      }),
    );
  });

  describe("deleteJob", () => {
    it.effect("should delete job and return true", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();

        vi.spyOn(ctx.mockCollection, "deleteOne").mockResolvedValueOnce({
          deletedCount: 1,
          acknowledged: true,
        });

        const result = yield* manager.deleteJob(jobId.toString());

        expect(result).toBe(true);
        expect(ctx.emitHistory).toContainEqual(expect.objectContaining({ event: "job:deleted" }));
      }),
    );

    it.effect("should return false for non-existent job", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "deleteOne").mockResolvedValueOnce({
          deletedCount: 0,
          acknowledged: true,
        });

        const result = yield* manager.deleteJob(new ObjectId().toString());

        expect(result).toBe(false);
      }),
    );

    it.effect("should emit job:deleted event with jobId", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();

        vi.spyOn(ctx.mockCollection, "deleteOne").mockResolvedValueOnce({
          deletedCount: 1,
          acknowledged: true,
        });

        yield* manager.deleteJob(jobId.toString());

        const deleteEvent = ctx.emitHistory.find((e) => e.event === "job:deleted");
        expect(deleteEvent).toBeDefined();
        expect((deleteEvent?.payload as { jobId: string })?.jobId).toBe(jobId.toString());
      }),
    );
  });

  describe("cancelJob - error handling", () => {
    it.effect("should wrap DB errors in ConnectionError", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const dbError = new Error("MongoNetworkError: connection pool closed");

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockRejectedValueOnce(dbError);

        const failureResult1 = yield* Effect.result(manager.cancelJob(jobId.toString()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect((error as ConnectionError).message).toBe(`Failed to cancel job: ${dbError.message}`);
        expect((error as ConnectionError).cause).toBe(dbError);
      }),
    );

    it.effect("should preserve JobStateError when thrown", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const stateError = new JobStateError(
          "Cannot cancel",
          jobId.toString(),
          "processing",
          "cancel",
        );
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockRejectedValueOnce(stateError);

        const failureResult1 = yield* Effect.result(manager.cancelJob(jobId.toString()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBe(stateError);
        expect(error).not.toBeInstanceOf(ConnectionError);
      }),
    );
  });

  describe("retryJob - error handling", () => {
    it.effect("should wrap DB errors in ConnectionError", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const dbError = new Error("MongoNetworkError: socket timeout");

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockRejectedValueOnce(dbError);

        const failureResult1 = yield* Effect.result(manager.retryJob(jobId.toString()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect((error as ConnectionError).message).toBe(`Failed to retry job: ${dbError.message}`);
        expect((error as ConnectionError).cause).toBe(dbError);
      }),
    );

    it.effect("should preserve JobStateError when thrown", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const pendingJob = JobFactory.build({ _id: jobId });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(pendingJob);

        const failureResult1 = yield* Effect.result(manager.retryJob(jobId.toString()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(JobStateError);
        expect(error).not.toBeInstanceOf(ConnectionError);
      }),
    );
  });

  describe("rescheduleJob - error handling", () => {
    it.effect("should wrap DB errors in ConnectionError", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const dbError = new Error("MongoNetworkError: connection refused");

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockRejectedValueOnce(dbError);

        const failureResult1 = yield* Effect.result(
          manager.rescheduleJob(jobId.toString(), new Date()),
        );
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect((error as ConnectionError).message).toBe(
          `Failed to reschedule job: ${dbError.message}`,
        );
        expect((error as ConnectionError).cause).toBe(dbError);
      }),
    );

    it.effect("should preserve JobStateError when thrown", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const processingJob = JobFactoryHelpers.processing({ _id: jobId });

        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(processingJob);

        const failureResult1 = yield* Effect.result(
          manager.rescheduleJob(jobId.toString(), new Date()),
        );
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(JobStateError);
        expect(error).not.toBeInstanceOf(ConnectionError);
      }),
    );
  });

  describe("deleteJob - error handling", () => {
    it.effect("should wrap DB errors in ConnectionError", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();
        const dbError = new Error("MongoNetworkError: connection pool exhausted");

        vi.spyOn(ctx.mockCollection, "deleteOne").mockRejectedValueOnce(dbError);

        const failureResult1 = yield* Effect.result(manager.deleteJob(jobId.toString()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect((error as ConnectionError).message).toBe(`Failed to delete job: ${dbError.message}`);
        expect((error as ConnectionError).cause).toBe(dbError);
      }),
    );

    it.effect("should wrap non-Error thrown values in ConnectionError", () =>
      Effect.gen(function* () {
        const jobId = new ObjectId();

        vi.spyOn(ctx.mockCollection, "deleteOne").mockRejectedValueOnce("String error");

        const failureResult1 = yield* Effect.result(manager.deleteJob(jobId.toString()));
        expect(failureResult1._tag).toBe("Failure");
        if (Result.isSuccess(failureResult1)) throw new Error("Expected operation to fail");
        const error = failureResult1.failure;
        expect(error).toBeInstanceOf(ConnectionError);
        expect((error as ConnectionError).message).toBe(
          "Failed to delete job: Unknown error during deleteJob",
        );
        expect(error).not.toHaveProperty("cause");
      }),
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Bulk Operations Tests
  // ─────────────────────────────────────────────────────────────────────────────

  describe("cancelJobs", () => {
    it.effect("should cancel all pending jobs matching filter via updateMany", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 3,
          matchedCount: 3,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });

        const result = yield* manager.cancelJobs({ name: "bulk-cancel" });

        expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
        const cancelCall = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
        expect(cancelCall).toBeDefined();
        const [query, update] = cancelCall ?? [];
        expect(query).toEqual(expect.objectContaining({ status: "pending" }));
        expect(update).toEqual(
          expect.objectContaining({
            $set: expect.objectContaining({ status: "cancelled" }),
          }),
        );
        expect(result).toEqual({ count: 3, errors: [] });
        expect(ctx.emitHistory).toContainEqual(
          expect.objectContaining({ event: "jobs:cancelled", payload: { count: 3 } }),
        );
      }),
    );

    it.effect("should return count 0 when no jobs match", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 0,
          matchedCount: 0,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });

        const result = yield* manager.cancelJobs({ name: "no-match" });

        expect(result).toEqual({ count: 0, errors: [] });
        expect(ctx.emitHistory).not.toContainEqual(
          expect.objectContaining({ event: "jobs:cancelled" }),
        );
      }),
    );

    it.effect("should return count 0 when filter status does not include pending", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 0,
          matchedCount: 0,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });

        const result = yield* manager.cancelJobs({ status: JobStatus.PROCESSING });

        expect(result).toEqual({ count: 0, errors: [] });
        expect(ctx.mockCollection.updateMany).not.toHaveBeenCalled();
      }),
    );

    it.effect("should cancel jobs when filter status includes pending", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 3,
          matchedCount: 3,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });

        const result = yield* manager.cancelJobs({ status: JobStatus.PENDING });

        expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
        const call = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
        expect(call).toBeDefined();
        const [query] = call ?? [];
        expect(query).toEqual(expect.objectContaining({ status: "pending" }));
        expect(result).toEqual({ count: 3, errors: [] });
      }),
    );
  });

  describe("retryJobs", () => {
    function mockRetryNotificationDocs(docs = JobFactory.buildList(1)) {
      const mockCursor = {
        async *[Symbol.asyncIterator]() {
          yield* docs;
        },
      };

      vi.spyOn(ctx.mockCollection, "find").mockReturnValueOnce(
        mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
      );
    }

    it.effect("notifies each retried job as the cursor yields it", () =>
      Effect.gen(function* () {
        const firstRunAt = new Date("2026-01-01T00:00:01.000Z");
        const secondRunAt = new Date("2026-01-01T00:00:02.000Z");
        let notificationsBeforeSecondJob = -1;
        const mockCursor = {
          async *[Symbol.asyncIterator]() {
            yield { name: "first", nextRunAt: firstRunAt };
            notificationsBeforeSecondJob = vi.mocked(ctx.notifyPendingJob).mock.calls.length;
            yield { name: "second", nextRunAt: secondRunAt };
          },
        };
        vi.spyOn(ctx.mockCollection, "find").mockReturnValueOnce(
          mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
        );
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 2,
          matchedCount: 2,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });

        yield* manager.retryJobs({});

        expect(notificationsBeforeSecondJob).toBe(1);
        expect(ctx.notifyPendingJob).toHaveBeenCalledWith("first", firstRunAt);
        expect(ctx.notifyPendingJob).toHaveBeenCalledWith("second", secondRunAt);
      }),
    );

    it.effect("closes the retry notification cursor before recovering a callback failure", () => {
      const notificationError = new Error("Notification callback failed");
      return Effect.gen(function* () {
        const nextRunAt = new Date("2026-01-01T00:00:01.000Z");
        let cursorClosed = false;
        let secondJobRead = false;
        const cursor = {
          async *[Symbol.asyncIterator]() {
            try {
              yield { name: "first", nextRunAt };
              secondJobRead = true;
              yield { name: "second", nextRunAt };
            } finally {
              cursorClosed = true;
            }
          },
        };
        vi.spyOn(ctx.mockCollection, "find").mockReturnValueOnce(
          cursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
        );
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 2,
          matchedCount: 2,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });
        vi.mocked(ctx.notifyPendingJob).mockImplementationOnce(() => {
          throw notificationError;
        });

        const result = yield* manager.retryJobs({ name: "bulk-retry" });

        expect(result).toEqual({ count: 2, errors: [] });
        expect(cursorClosed).toBe(true);
        expect(secondJobRead).toBe(false);
        expect(ctx.emitHistory).toContainEqual({
          event: "job:error",
          payload: { error: notificationError },
        });
        expect(ctx.notifyPendingJob).toHaveBeenCalledTimes(2);
        expect(ctx.notifyPendingJob).toHaveBeenLastCalledWith("bulk-retry", expect.any(Date));
      });
    });

    it.effect("should retry all failed/cancelled jobs via updateMany with pipeline", () =>
      Effect.gen(function* () {
        const bulkEmail = JobFactory.build({
          name: "bulk-email",
          nextRunAt: new Date("2026-01-01T00:00:01.000Z"),
        });
        const bulkReport = JobFactory.build({
          name: "bulk-report",
          nextRunAt: new Date("2026-01-01T00:00:02.000Z"),
        });
        const notificationJobs = [bulkEmail, bulkReport];
        mockRetryNotificationDocs(notificationJobs);
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 5,
          matchedCount: 5,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });

        const result = yield* manager.retryJobs({});

        expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
        const retryCall = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
        expect(retryCall).toBeDefined();
        const [query, update] = retryCall ?? [];
        expect(query).toEqual(
          expect.objectContaining({ status: { $in: ["failed", "cancelled"] } }),
        );
        // Pipeline-style update: second argument must be an array
        expect(Array.isArray(update)).toBe(true);
        expect(result).toEqual({ count: 5, errors: [] });
        expect(ctx.emitHistory).toContainEqual(
          expect.objectContaining({ event: "jobs:retried", payload: { count: 5 } }),
        );
        expect(ctx.mockCollection.find).toHaveBeenCalledWith(
          {
            status: JobStatus.PENDING,
            updatedAt: expect.any(Date),
          },
          { projection: { name: 1, nextRunAt: 1 } },
        );
        expect(ctx.notifyPendingJob).toHaveBeenCalledWith("bulk-email", bulkEmail.nextRunAt);
        expect(ctx.notifyPendingJob).toHaveBeenCalledWith("bulk-report", bulkReport.nextRunAt);
      }),
    );

    it.effect(
      "retains the name and date scope while replacing terminal status for retry notifications",
      () =>
        Effect.gen(function* () {
          const olderThan = new Date("2026-02-01T00:00:00.000Z");
          const newerThan = new Date("2026-01-01T00:00:00.000Z");
          const scope = { name: "bulk-retry", olderThan, newerThan };
          mockRetryNotificationDocs([]);
          vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
            modifiedCount: 3,
            matchedCount: 3,
            acknowledged: true,
            upsertedCount: 0,
            upsertedId: null,
          });

          const result = yield* manager.retryJobs({ ...scope, status: JobStatus.FAILED });

          expect(ctx.mockCollection.updateMany).toHaveBeenCalledOnce();
          const retryCall = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
          expect(retryCall).toBeDefined();
          const [query] = retryCall ?? [];
          expect(query).toEqual({
            name: scope.name,
            status: JobStatus.FAILED,
            createdAt: { $lt: olderThan, $gt: newerThan },
          });
          expect(ctx.mockCollection.find).toHaveBeenCalledWith(
            { ...query, status: JobStatus.PENDING, updatedAt: expect.any(Date) },
            { projection: { name: 1, nextRunAt: 1 } },
          );
          expect(result).toEqual({ count: 3, errors: [] });
          expect(ctx.notifyPendingJob).toHaveBeenCalledWith(scope.name, expect.any(Date));
        }),
    );

    it.effect("should return count 0 when filter status does not include retryable statuses", () =>
      Effect.gen(function* () {
        const result = yield* manager.retryJobs({ status: JobStatus.COMPLETED });

        expect(result).toEqual({ count: 0, errors: [] });
        expect(ctx.mockCollection.updateMany).not.toHaveBeenCalled();
      }),
    );

    it.effect("should return count 0 when no jobs match", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 0,
          matchedCount: 0,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });

        const result = yield* manager.retryJobs({ name: "no-match" });

        expect(result).toEqual({ count: 0, errors: [] });
        expect(ctx.emitHistory).not.toContainEqual(
          expect.objectContaining({ event: "jobs:retried" }),
        );
      }),
    );

    it.effect("should keep bulk retry successful when notification lookup fails", () => {
      const notificationError = new Error("Notification lookup failed");
      return Effect.gen(function* () {
        const mockCursor = {
          async *[Symbol.asyncIterator]() {
            yield await Promise.reject(notificationError);
          },
        };

        vi.spyOn(ctx.mockCollection, "find").mockReturnValueOnce(
          mockCursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
        );
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 1,
          matchedCount: 1,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });

        const result = yield* manager.retryJobs({ name: "bulk-retry" });

        expect(result).toEqual({ count: 1, errors: [] });
        expect(ctx.emitHistory).toContainEqual(
          expect.objectContaining({
            event: "job:error",
            payload: { error: notificationError },
          }),
        );
        expect(ctx.notifyPendingJob).toHaveBeenCalledWith("bulk-retry", expect.any(Date));
      });
    });

    it.effect("should use pipeline-style update with $rand stagger", () =>
      Effect.gen(function* () {
        mockRetryNotificationDocs([]);
        vi.spyOn(ctx.mockCollection, "updateMany").mockResolvedValueOnce({
          modifiedCount: 1,
          matchedCount: 1,
          acknowledged: true,
          upsertedCount: 0,
          upsertedId: null,
        });

        yield* manager.retryJobs({ status: JobStatus.FAILED });

        const pipelineCall = vi.mocked(ctx.mockCollection.updateMany).mock.calls[0];
        expect(pipelineCall).toBeDefined();
        const [, update] = pipelineCall ?? [];
        const pipeline = update as Record<string, unknown>[];
        const setStage = pipeline[0] as { $set: Record<string, unknown> };
        expect(setStage).toHaveProperty("$set");
        expect(setStage.$set).toHaveProperty("nextRunAt");
        const nextRunAt = setStage.$set["nextRunAt"] as Record<string, unknown>;
        expect(nextRunAt).toHaveProperty("$add");
        const addExpr = nextRunAt["$add"] as unknown[];
        expect(addExpr).toHaveLength(2);
        const multiplyExpr = addExpr[1] as Record<string, unknown>;
        expect(multiplyExpr).toHaveProperty("$multiply");
        const multiplyArgs = multiplyExpr["$multiply"] as unknown[];
        expect(multiplyArgs).toContainEqual({ $rand: {} });
      }),
    );
  });

  describe("deleteJobs", () => {
    it.effect("should delete multiple jobs matching filter", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "deleteMany").mockResolvedValueOnce({
          deletedCount: 5,
          acknowledged: true,
        });

        const result = yield* manager.deleteJobs({ status: JobStatus.COMPLETED });

        expect(result.count).toBe(5);
        expect(result.errors).toHaveLength(0);
        expect(ctx.emitHistory).toContainEqual(
          expect.objectContaining({
            event: "jobs:deleted",
            payload: { count: 5 },
          }),
        );
      }),
    );

    it.effect("should return zero count when no jobs match", () =>
      Effect.gen(function* () {
        vi.spyOn(ctx.mockCollection, "deleteMany").mockResolvedValueOnce({
          deletedCount: 0,
          acknowledged: true,
        });

        const result = yield* manager.deleteJobs({ name: "non-existent" });

        expect(result.count).toBe(0);
        expect(result.errors).toHaveLength(0);
      }),
    );
  });
  describe("job id validation", () => {
    it.effect("should return null without querying for invalid cancel ids", () =>
      Effect.gen(function* () {
        const result = yield* manager.cancelJob("not-an-object-id");

        expect(result).toBeNull();
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
        expect(ctx.mockCollection.findOne).not.toHaveBeenCalled();
      }),
    );

    it.effect("should return null without querying for invalid retry ids", () =>
      Effect.gen(function* () {
        const result = yield* manager.retryJob("not-an-object-id");

        expect(result).toBeNull();
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
        expect(ctx.mockCollection.findOne).not.toHaveBeenCalled();
      }),
    );

    it.effect("should return null without querying for invalid reschedule ids", () =>
      Effect.gen(function* () {
        const result = yield* manager.rescheduleJob("not-an-object-id", new Date());

        expect(result).toBeNull();
        expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
        expect(ctx.mockCollection.findOne).not.toHaveBeenCalled();
      }),
    );
  });
});
