import { it } from "@effect/vitest";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { DateTime, Effect } from "effect";
import { MongoBulkWriteError, MongoServerError, ObjectId } from "mongodb";
import type { BulkWriteResult } from "mongodb";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { JobIntake } from "@/scheduler/services/job-intake";
import { ConnectionError, InvalidCronError, InvalidJobIdentifierError } from "@/shared";
import { createMockContext, JobFactory } from "@tests/factories";
import { anyMatcher, stringMatchingMatcher } from "@tests/setup/matchers.js";

describe(JobIntake, () => {
  let ctx: ReturnType<typeof createMockContext>;
  let intake: JobIntake;
  beforeEach(() => {
    ctx = createMockContext();
    intake = new JobIntake(ctx);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });
  it.effect.each([
    { code: 11_000, count: 3 },
    { code: 91, count: 2 },
  ])("preserves partial bulk failures after an earlier duplicate: %j", ({ code, count }) =>
    Effect.gen(function* effectWorkflow1() {
      const insertedId = new ObjectId();
      const result = fromPartial<BulkWriteResult>({
        upsertedCount: 1,
        matchedCount: 0,
        upsertedIds: { 1: insertedId },
        getWriteErrors: () => [{ code: 11_000, index: 0 }],
        getWriteConcernError: () => {},
      });
      const error = new MongoBulkWriteError({ message: "Later batch failed", code }, result);
      vi.spyOn(ctx.mockCollection, "bulkWrite").mockRejectedValueOnce(error);
      expect(
        yield* Effect.result(
          intake.enqueueMany(
            Array.from({ length: count }, (_, index) => ({
              name: "work",
              data: { index },
              uniqueKey: String(index),
            })),
          ),
        ),
      ).toMatchObject({ _tag: "Failure", failure: { cause: error } });
      expect({
        mockCollectionFindMockCallsLength: ctx.mockCollection.find.mock.calls.length,
        notifyPendingJobMockCallsLength: ctx.notifyPendingJob.mock.calls.length,
      }).toStrictEqual({
        mockCollectionFindMockCallsLength: 0,
        notifyPendingJobMockCallsLength: 1,
      });
    }),
  );
  it.effect.each([JobStatus.PENDING, JobStatus.PROCESSING])(
    "returns the competing %s job after an active-key upsert race",
    (status) =>
      Effect.gen(function* effectWorkflow2() {
        const existing = JobFactory.build({ name: "work", uniqueKey: "shared", status });
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockRejectedValueOnce(
          new MongoServerError({
            message: "Concurrent upsert lost",
            code: 11_000,
            keyPattern: { name: 1, uniqueKey: 1 },
          }),
        );
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(existing);
        const job = yield* intake.enqueue("work", { replacement: true }, { uniqueKey: "shared" });
        expect(job).toStrictEqual(existing);
        expect(ctx.mockCollection.findOne).toHaveBeenCalledWith(
          {
            name: "work",
            uniqueKey: "shared",
            status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
          },
          { readPreference: "primary" },
        );
      }),
  );
  it.effect("preserves a duplicate error from another unique index", () =>
    Effect.gen(function* effectWorkflow3() {
      const error = new MongoServerError({
        message: "Other index",
        code: 11_000,
        keyPattern: { "data.id": 1 },
      });
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockRejectedValueOnce(error);
      expect(
        yield* Effect.result(intake.enqueue("work", {}, { uniqueKey: "shared" })),
      ).toMatchObject({
        _tag: "Failure",
        failure: {
          cause: error,
        },
      });
      expect(ctx.mockCollection.findOne).not.toHaveBeenCalled();
    }),
  );
  it.effect("preserves the collision when the competing job is no longer active", () =>
    Effect.gen(function* effectWorkflow4() {
      const error = new MongoServerError({
        message: "Concurrent upsert lost",
        code: 11_000,
        keyPattern: { name: 1, uniqueKey: 1 },
      });
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockRejectedValueOnce(error);
      vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(null);
      expect(
        yield* Effect.result(intake.schedule("* * * * *", "work", {}, { uniqueKey: "shared" })),
      ).toMatchObject({ _tag: "Failure", failure: { cause: error } });
    }),
  );
  it.effect("rejects invalid job names before hitting MongoDB", () =>
    Effect.gen(function* effectWorkflow5() {
      expect(yield* Effect.result(intake.enqueue("invalid job name", { value: 42 }))).toMatchObject(
        { _tag: "Failure", failure: anyMatcher(InvalidJobIdentifierError) },
      );
      expect({
        mockCollectionInsertOneMockCallsLength: ctx.mockCollection.insertOne.mock.calls.length,
        mockCollectionFindOneAndUpdateMockCallsLength:
          ctx.mockCollection.findOneAndUpdate.mock.calls.length,
      }).toStrictEqual({
        mockCollectionInsertOneMockCallsLength: 0,
        mockCollectionFindOneAndUpdateMockCallsLength: 0,
      });
    }),
  );
  it.effect("rejects invalid unique keys before hitting MongoDB", () =>
    Effect.gen(function* effectWorkflow6() {
      expect(
        yield* Effect.result(intake.enqueue("valid-job", { value: 42 }, { uniqueKey: "   " })),
      ).toMatchObject({ _tag: "Failure", failure: anyMatcher(InvalidJobIdentifierError) });
      expect({
        mockCollectionInsertOneMockCallsLength: ctx.mockCollection.insertOne.mock.calls.length,
        mockCollectionFindOneAndUpdateMockCallsLength:
          ctx.mockCollection.findOneAndUpdate.mock.calls.length,
      }).toStrictEqual({
        mockCollectionInsertOneMockCallsLength: 0,
        mockCollectionFindOneAndUpdateMockCallsLength: 0,
      });
    }),
  );
  it.effect("enqueues a pending job and notifies the scheduler", () =>
    Effect.gen(function* effectWorkflow7() {
      const insertedId = new ObjectId();
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
      const job = yield* intake.enqueue("send-email", { to: "user@example.com" });
      expect(job).toMatchObject({
        _id: insertedId,
        name: "send-email",
        data: { to: "user@example.com" },
        status: JobStatus.PENDING,
        failCount: 0,
      });
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.updatedAt).toBeInstanceOf(Date);
      expect(job.nextRunAt).toBeInstanceOf(Date);
      expect(ctx.notifyPendingJob).toHaveBeenCalledWith("send-email", job.nextRunAt);
    }),
  );
  it.effect("uses runAt option for delayed execution", () =>
    Effect.gen(function* effectWorkflow8() {
      const insertedId = new ObjectId();
      const runAt = new Date(Date.now() + 3_600_000);
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
      const job = yield* intake.enqueue("delayed-job", { x: 1 }, { runAt });
      const [insertCall] = ctx.mockCollection.insertOne.mock.calls;
      const insertedDoc = fromAny<{ nextRunAt: Date; uniqueKey?: string }, unknown>(
        insertCall?.[0],
      );
      expect({
        insertedDocNextRunAt: insertedDoc.nextRunAt,
        jobNextRunAt: job.nextRunAt,
      }).toStrictEqual({
        insertedDocNextRunAt: runAt,
        jobNextRunAt: runAt,
      });
    }),
  );
  it.effect("omits uniqueKey when not provided", () =>
    Effect.gen(function* effectWorkflow9() {
      const insertedId = new ObjectId();
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
      yield* intake.enqueue("job", { x: 1 });
      const [insertCall] = ctx.mockCollection.insertOne.mock.calls;
      const insertedDoc = fromAny<{ nextRunAt: Date; uniqueKey?: string }, unknown>(
        insertCall?.[0],
      );
      expect(insertedDoc.uniqueKey).toBeUndefined();
    }),
  );
  it.effect("returns the existing pending job for duplicate unique intake", () =>
    Effect.gen(function* effectWorkflow10() {
      const existingJob = JobFactory.build({
        name: "sync-user",
        uniqueKey: "user-123",
        data: { userId: "user-123" },
      });
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(existingJob);
      const job = yield* intake.enqueue(
        "sync-user",
        { userId: "ignored" },
        { uniqueKey: "user-123" },
      );
      expect({
        job_id: job._id,
        jobData: job.data,
      }).toStrictEqual({
        job_id: existingJob._id,
        jobData: existingJob.data,
      });
      expect(ctx.notifyPendingJob).toHaveBeenCalledWith("sync-user", existingJob.nextRunAt);
    }),
  );
  it.effect("returns the existing processing job for duplicate unique intake", () =>
    Effect.gen(function* effectWorkflow11() {
      const existingJob = JobFactory.build({
        name: "sync-user",
        uniqueKey: "user-123",
        data: { userId: "user-123" },
        status: JobStatus.PROCESSING,
      });
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(existingJob);
      const job = yield* intake.enqueue(
        "sync-user",
        { userId: "ignored" },
        { uniqueKey: "user-123" },
      );
      expect({
        job_id: job._id,
        jobData: job.data,
        notifyPendingJobMockCallsLength: ctx.notifyPendingJob.mock.calls.length,
      }).toStrictEqual({
        job_id: existingJob._id,
        jobData: existingJob.data,
        notifyPendingJobMockCallsLength: 0,
      });
    }),
  );
  it.effect("throws ConnectionError when enqueue insert fails", () =>
    Effect.gen(function* effectWorkflow12() {
      vi.spyOn(ctx.mockCollection, "insertOne").mockRejectedValueOnce(
        new Error("Database connection lost"),
      );
      const result = yield* Effect.result(intake.enqueue("failing-job", {}));
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: anyMatcher(ConnectionError),
      });
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { message: "Failed to enqueue job: Database connection lost" },
      });
    }),
  );
  it.effect("throws ConnectionError when unique enqueue returns no document", () =>
    Effect.gen(function* effectWorkflow13() {
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);
      expect(
        yield* Effect.result(intake.enqueue("unique-job", {}, { uniqueKey: "key" })),
      ).toMatchObject({ _tag: "Failure", failure: anyMatcher(ConnectionError) });
    }),
  );
  it.effect("enqueues an immediate job", () =>
    Effect.gen(function* effectWorkflow14() {
      const insertedId = new ObjectId();
      const beforeCall = yield* DateTime.nowAsDate;
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
      const job = yield* intake.now("immediate-job", { urgent: true });
      const afterCall = yield* DateTime.nowAsDate;
      expect(job._id).toStrictEqual(insertedId);
      expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    }),
  );
  it.effect("rejects invalid scheduled job names before parsing cron", () =>
    Effect.gen(function* effectWorkflow15() {
      expect(yield* Effect.result(intake.schedule("not-a-cron", "bad name", {}))).toMatchObject({
        _tag: "Failure",
        failure: anyMatcher(InvalidJobIdentifierError),
      });
      expect(ctx.mockCollection.insertOne).not.toHaveBeenCalled();
    }),
  );
  it.effect("schedules a pending recurring job", () =>
    Effect.gen(function* effectWorkflow16() {
      const insertedId = new ObjectId();
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
      const job = yield* intake.schedule("0 * * * *", "hourly-report", { report: "sales" });
      expect(job).toMatchObject({
        _id: insertedId,
        name: "hourly-report",
        data: { report: "sales" },
        status: JobStatus.PENDING,
        repeatInterval: "0 * * * *",
        failCount: 0,
      });
      expect(job.nextRunAt).toBeInstanceOf(Date);
      expect(ctx.notifyPendingJob).toHaveBeenCalledWith("hourly-report", job.nextRunAt);
    }),
  );
  it.effect("throws InvalidCronError for invalid cron expression", () =>
    Effect.gen(function* effectWorkflow17() {
      expect(yield* Effect.result(intake.schedule("invalid cron", "bad-job", {}))).toMatchObject({
        _tag: "Failure",
        failure: anyMatcher(InvalidCronError),
      });
    }),
  );
  it.effect("returns the existing pending recurring job for duplicate unique schedule intake", () =>
    Effect.gen(function* effectWorkflow18() {
      const existingJob = JobFactory.build({
        name: "daily-report",
        uniqueKey: "sales-report",
        repeatInterval: "0 0 * * *",
        data: { report: "sales" },
      });
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(existingJob);
      const job = yield* intake.schedule(
        "0 0 * * *",
        "daily-report",
        { report: "ignored" },
        { uniqueKey: "sales-report" },
      );
      expect({
        job_id: job._id,
        jobData: job.data,
        jobRepeatInterval: job.repeatInterval,
      }).toStrictEqual({
        job_id: existingJob._id,
        jobData: existingJob.data,
        jobRepeatInterval: "0 0 * * *",
      });
      expect(ctx.notifyPendingJob).toHaveBeenCalledWith("daily-report", existingJob.nextRunAt);
    }),
  );
  it.effect(
    "returns the existing processing recurring job for duplicate unique schedule intake",
    () =>
      Effect.gen(function* effectWorkflow19() {
        const existingJob = JobFactory.build({
          name: "daily-report",
          uniqueKey: "sales-report",
          repeatInterval: "0 0 * * *",
          data: { report: "sales" },
          status: JobStatus.PROCESSING,
        });
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(existingJob);
        const job = yield* intake.schedule(
          "0 0 * * *",
          "daily-report",
          { report: "ignored" },
          { uniqueKey: "sales-report" },
        );
        expect({
          job_id: job._id,
          jobData: job.data,
          jobRepeatInterval: job.repeatInterval,
          notifyPendingJobMockCallsLength: ctx.notifyPendingJob.mock.calls.length,
        }).toStrictEqual({
          job_id: existingJob._id,
          jobData: existingJob.data,
          jobRepeatInterval: "0 0 * * *",
          notifyPendingJobMockCallsLength: 0,
        });
      }),
  );
  it.effect("supports predefined cron expressions like @daily", () =>
    Effect.gen(function* effectWorkflow20() {
      const insertedId = new ObjectId();
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
      const job = yield* intake.schedule("@daily", "daily-job", {});
      expect(job.repeatInterval).toBe("@daily");
    }),
  );
  it.effect("throws ConnectionError when unique schedule returns no document", () =>
    Effect.gen(function* effectWorkflow21() {
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);
      expect(
        yield* Effect.result(
          intake.schedule("0 * * * *", "unique-schedule", {}, { uniqueKey: "key" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: anyMatcher(ConnectionError) });
      expect(
        yield* Effect.result(
          intake.schedule("0 * * * *", "unique-schedule", {}, { uniqueKey: "key" }),
        ),
      ).toMatchObject({
        _tag: "Failure",
        failure: { message: stringMatchingMatcher(/findOneAndUpdate returned no document/u) },
      });
    }),
  );
  it.effect("throws ConnectionError when schedule insert fails", () =>
    Effect.gen(function* effectWorkflow22() {
      vi.spyOn(ctx.mockCollection, "insertOne").mockRejectedValueOnce(
        new Error("Database write failed"),
      );
      const result = yield* Effect.result(intake.schedule("0 * * * *", "failing-schedule", {}));
      expect(result).toMatchObject({ _tag: "Failure", failure: anyMatcher(ConnectionError) });
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { message: "Failed to schedule job: Database write failed" },
      });
    }),
  );
});
