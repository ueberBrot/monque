import { it } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { type BulkWriteResult, MongoBulkWriteError, MongoServerError, ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { JobIntake } from "@/scheduler/services/job-intake";
import { ConnectionError, InvalidCronError, InvalidJobIdentifierError } from "@/shared";
import { createMockContext, JobFactory } from "@tests/factories";

describe("JobIntake", () => {
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
    { code: 11000, count: 3 },
    { code: 91, count: 2 },
  ])("preserves partial bulk failures after an earlier duplicate: %j", ({ code, count }) =>
    Effect.gen(function* () {
      const insertedId = new ObjectId();
      const result = {
        upsertedCount: 1,
        matchedCount: 0,
        upsertedIds: { 1: insertedId },
        getWriteErrors: () => [{ code: 11000, index: 0 }],
        getWriteConcernError: () => undefined,
      } as unknown as BulkWriteResult;
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
      expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      expect(ctx.notifyPendingJob).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect.each([JobStatus.PENDING, JobStatus.PROCESSING])(
    "returns the competing %s job after an active-key upsert race",
    (status) =>
      Effect.gen(function* () {
        const existing = JobFactory.build({ name: "work", uniqueKey: "shared", status });
        vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockRejectedValueOnce(
          new MongoServerError({
            message: "Concurrent upsert lost",
            code: 11000,
            keyPattern: { name: 1, uniqueKey: 1 },
          }),
        );
        vi.spyOn(ctx.mockCollection, "findOne").mockResolvedValueOnce(existing);
        const job = yield* intake.enqueue("work", { replacement: true }, { uniqueKey: "shared" });
        expect(job).toEqual(existing);
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
    Effect.gen(function* () {
      const error = new MongoServerError({
        message: "Other index",
        code: 11000,
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
    Effect.gen(function* () {
      const error = new MongoServerError({
        message: "Concurrent upsert lost",
        code: 11000,
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
    Effect.gen(function* () {
      expect(yield* Effect.result(intake.enqueue("invalid job name", { value: 42 }))).toMatchObject(
        { _tag: "Failure", failure: expect.any(InvalidJobIdentifierError) },
      );
      expect(ctx.mockCollection.insertOne).not.toHaveBeenCalled();
      expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    }),
  );

  it.effect("rejects invalid unique keys before hitting MongoDB", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.result(intake.enqueue("valid-job", { value: 42 }, { uniqueKey: "   " })),
      ).toMatchObject({ _tag: "Failure", failure: expect.any(InvalidJobIdentifierError) });
      expect(ctx.mockCollection.insertOne).not.toHaveBeenCalled();
      expect(ctx.mockCollection.findOneAndUpdate).not.toHaveBeenCalled();
    }),
  );

  it.effect("enqueues a pending job and notifies the scheduler", () =>
    Effect.gen(function* () {
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
    Effect.gen(function* () {
      const insertedId = new ObjectId();
      const runAt = new Date(Date.now() + 3600000);

      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });

      const job = yield* intake.enqueue("delayed-job", { x: 1 }, { runAt });
      const insertCall = (ctx.mockCollection.insertOne as ReturnType<typeof vi.fn>).mock.calls[0];
      const insertedDoc = insertCall?.[0] as Record<string, unknown>;

      expect(insertedDoc["nextRunAt"]).toEqual(runAt);
      expect(job.nextRunAt).toEqual(runAt);
    }),
  );

  it.effect("omits uniqueKey when not provided", () =>
    Effect.gen(function* () {
      const insertedId = new ObjectId();
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });

      yield* intake.enqueue("job", { x: 1 });
      const insertCall = (ctx.mockCollection.insertOne as ReturnType<typeof vi.fn>).mock.calls[0];
      const insertedDoc = insertCall?.[0] as Record<string, unknown>;

      expect(insertedDoc["uniqueKey"]).toBeUndefined();
    }),
  );

  it.effect("returns the existing pending job for duplicate unique intake", () =>
    Effect.gen(function* () {
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

      expect(job._id).toEqual(existingJob._id);
      expect(job.data).toEqual(existingJob.data);
      expect(ctx.notifyPendingJob).toHaveBeenCalledWith("sync-user", existingJob.nextRunAt);
    }),
  );

  it.effect("returns the existing processing job for duplicate unique intake", () =>
    Effect.gen(function* () {
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

      expect(job._id).toEqual(existingJob._id);
      expect(job.data).toEqual(existingJob.data);
      expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
    }),
  );

  it.effect("throws ConnectionError when enqueue insert fails", () =>
    Effect.gen(function* () {
      vi.spyOn(ctx.mockCollection, "insertOne").mockRejectedValueOnce(
        new Error("Database connection lost"),
      );

      expect(yield* Effect.result(intake.enqueue("failing-job", {}))).toMatchObject({
        _tag: "Failure",
        failure: expect.any(ConnectionError),
      });
      expect(yield* Effect.result(intake.enqueue("failing-job", {}))).toMatchObject({
        _tag: "Failure",
        failure: { message: expect.stringMatching(/Failed to enqueue job/) },
      });
    }),
  );

  it.effect("throws ConnectionError when unique enqueue returns no document", () =>
    Effect.gen(function* () {
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValueOnce(null);

      expect(
        yield* Effect.result(intake.enqueue("unique-job", {}, { uniqueKey: "key" })),
      ).toMatchObject({ _tag: "Failure", failure: expect.any(ConnectionError) });
    }),
  );

  it.effect("enqueues an immediate job", () =>
    Effect.gen(function* () {
      const insertedId = new ObjectId();
      const beforeCall = yield* DateTime.nowAsDate;

      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });

      const job = yield* intake.now("immediate-job", { urgent: true });
      const afterCall = yield* DateTime.nowAsDate;

      expect(job._id).toEqual(insertedId);
      expect(job.nextRunAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
      expect(job.nextRunAt.getTime()).toBeLessThanOrEqual(afterCall.getTime());
    }),
  );

  it.effect("rejects invalid scheduled job names before parsing cron", () =>
    Effect.gen(function* () {
      expect(yield* Effect.result(intake.schedule("not-a-cron", "bad name", {}))).toMatchObject({
        _tag: "Failure",
        failure: expect.any(InvalidJobIdentifierError),
      });
      expect(ctx.mockCollection.insertOne).not.toHaveBeenCalled();
    }),
  );

  it.effect("schedules a pending recurring job", () =>
    Effect.gen(function* () {
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
    Effect.gen(function* () {
      expect(yield* Effect.result(intake.schedule("invalid cron", "bad-job", {}))).toMatchObject({
        _tag: "Failure",
        failure: expect.any(InvalidCronError),
      });
    }),
  );

  it.effect("returns the existing pending recurring job for duplicate unique schedule intake", () =>
    Effect.gen(function* () {
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

      expect(job._id).toEqual(existingJob._id);
      expect(job.data).toEqual(existingJob.data);
      expect(job.repeatInterval).toBe("0 0 * * *");
      expect(ctx.notifyPendingJob).toHaveBeenCalledWith("daily-report", existingJob.nextRunAt);
    }),
  );

  it.effect(
    "returns the existing processing recurring job for duplicate unique schedule intake",
    () =>
      Effect.gen(function* () {
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

        expect(job._id).toEqual(existingJob._id);
        expect(job.data).toEqual(existingJob.data);
        expect(job.repeatInterval).toBe("0 0 * * *");
        expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
      }),
  );

  it.effect("supports predefined cron expressions like @daily", () =>
    Effect.gen(function* () {
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
    Effect.gen(function* () {
      vi.spyOn(ctx.mockCollection, "findOneAndUpdate").mockResolvedValue(null);

      expect(
        yield* Effect.result(
          intake.schedule("0 * * * *", "unique-schedule", {}, { uniqueKey: "key" }),
        ),
      ).toMatchObject({ _tag: "Failure", failure: expect.any(ConnectionError) });
      expect(
        yield* Effect.result(
          intake.schedule("0 * * * *", "unique-schedule", {}, { uniqueKey: "key" }),
        ),
      ).toMatchObject({
        _tag: "Failure",
        failure: { message: expect.stringMatching(/findOneAndUpdate returned no document/) },
      });
    }),
  );

  it.effect("throws ConnectionError when schedule insert fails", () =>
    Effect.gen(function* () {
      vi.spyOn(ctx.mockCollection, "insertOne").mockRejectedValueOnce(
        new Error("Database write failed"),
      );

      expect(
        yield* Effect.result(intake.schedule("0 * * * *", "failing-schedule", {})),
      ).toMatchObject({ _tag: "Failure", failure: expect.any(ConnectionError) });
      expect(
        yield* Effect.result(intake.schedule("0 * * * *", "failing-schedule", {})),
      ).toMatchObject({
        _tag: "Failure",
        failure: { message: expect.stringMatching(/Failed to schedule job/) },
      });
    }),
  );
});
