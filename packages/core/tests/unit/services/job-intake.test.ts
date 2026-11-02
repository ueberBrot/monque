import { ok } from "node:assert/strict";
import { createRequire } from "node:module";
import { it } from "@effect/vitest";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import { DateTime, Effect } from "effect";
import { BSON, MongoBulkWriteError, MongoServerError, ObjectId } from "mongodb";
import type {
  BulkWriteResult,
  BulkWriteOperationError,
  WriteError as NativeWriteError,
  ClientSession,
} from "mongodb";
import { afterEach, beforeEach, describe, expect, vi } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { makeNativeJobIntake } from "@/scheduler/services/job-intake";
import { JobPersistenceError } from "@/scheduler/services/job-persistence-error.js";
import {
  ConnectionError,
  InvalidCronError,
  InvalidJobIdentifierError,
  PayloadTooLargeError,
} from "@/shared";
import { createMockContext, JobFactory } from "@tests/factories";
import { anyMatcher, stringMatchingMatcher } from "@tests/setup/matchers.js";

interface BulkResultFixture {
  ok: number;
  nInserted: number;
  nUpserted: number;
  nMatched: number;
  nModified: number;
  nRemoved: number;
  upserted: { index: number; _id: ObjectId }[];
  insertedIds: { index: number; _id: ObjectId }[];
  writeErrors: NativeWriteError[];
  writeConcernErrors: [];
}

const nativeBulk: unknown = createRequire(import.meta.url)("mongodb/lib/bulk/common.js");

const { BulkWriteResult: NativeBulkWriteResult, WriteError } = fromAny<
  {
    BulkWriteResult: new (result: BulkResultFixture, ordered: boolean) => BulkWriteResult;
    WriteError: new (error: BulkWriteOperationError) => NativeWriteError;
  },
  unknown
>(nativeBulk);

describe("Native Job intake", () => {
  let ctx: ReturnType<typeof createMockContext>;
  let intake: ReturnType<typeof makeNativeJobIntake>;
  beforeEach(() => {
    ctx = createMockContext();
    intake = makeNativeJobIntake(ctx);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });
  it.effect("retains the original transaction failure in the typed native error channel", () =>
    Effect.gen(function* transactionFailure() {
      const native = new MongoServerError({
        message: "Write conflict",
        code: 112,
        errorLabels: ["TransientTransactionError"],
      });

      const session = fromPartial<ClientSession>({ inTransaction: () => true });
      vi.spyOn(ctx.mockCollection, "insertOne").mockRejectedValueOnce(native);
      const failure = yield* Effect.flip(intake.enqueue("work", {}, { session }));
      ok(failure instanceof JobPersistenceError);

      expect(failure.cause).toBe(native);
      expect(ctx.notifyPendingJob).not.toHaveBeenCalled();
    }),
  );
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
  it.effect.each([
    {
      label: "unrelated index",
      message: "E11000 duplicate key error index: data.email_1 dup key: { data.email: taken }",
      metadata: { keyPattern: { "data.email": 1 }, keyValue: { "data.email": "taken" } },
    },
    { label: "unattributed duplicate", message: "E11000 duplicate key error", metadata: {} },
    {
      label: "an unrelated index with a misleading key value",
      metadata: {},
      message:
        'E11000 duplicate key error collection: test.jobs index: data.email_1 dup key: { data.email: " index: name_1_uniqueKey_1 dup key: " }',
    },
    {
      label: "a similarly named index",
      metadata: {},
      message:
        "E11000 duplicate key error collection: test.jobs index: other_name_1_uniqueKey_1 dup key: { other: 1 }",
    },
  ])(
    "retains a native bulk rejection for $label despite a later matching active key",
    ({ metadata, message }) =>
      Effect.gen(function* unrelatedBulkConflict() {
        const writeError = new WriteError({
          code: 11_000,
          index: 0,
          errmsg: message,
          errInfo: metadata,
          op: {},
        });

        const result = new NativeBulkWriteResult(
          {
            ok: 1,
            nInserted: 0,
            nUpserted: 1,
            nMatched: 0,
            nModified: 0,
            nRemoved: 0,
            upserted: [{ index: 1, _id: new ObjectId() }],
            insertedIds: [],
            writeErrors: [writeError],
            writeConcernErrors: [],
          },
          false,
        );

        const native = new MongoBulkWriteError(
          { message: writeError.errmsg ?? "Duplicate", code: 11_000, writeErrors: [writeError] },
          result,
        );

        ctx.mockCollection.bulkWrite.mockRejectedValueOnce(native);
        ctx.mockCollection.find.mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.find>>({
            toArray: async () => await Promise.resolve([{ name: "work", uniqueKey: "shared" }]),
          }),
        );

        const failure = yield* Effect.flip(
          intake.enqueueMany([
            { name: "work", uniqueKey: "shared", data: { email: "taken" } },
            { name: "work", uniqueKey: "shared", data: { email: "free" }, runAt: new Date(1000) },
          ]),
        );

        ok(failure instanceof ConnectionError);
        expect(failure.cause).toBe(native);
        expect({
          result: native.result,
          errors: native.result.getWriteErrors(),
          upsertedIndices: Object.keys(native.result.upsertedIds),
        }).toStrictEqual({ result, errors: [writeError], upsertedIndices: ["1"] });
        expect(ctx.notifyPendingJob).toHaveBeenCalledExactlyOnceWith("work", new Date(1000));
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
  );
  it.effect.each([
    {
      label: "key pattern",
      metadata: {
        keyPattern: { name: 1, uniqueKey: 1 },
        keyValue: { name: "work", uniqueKey: "shared" },
      },
      message: "Duplicate key",
    },
    {
      label: "native index name",
      metadata: {},
      message:
        "E11000 duplicate key error collection: test.jobs index: name_1_uniqueKey_1 dup key: { name: work, uniqueKey: shared }",
    },
  ])(
    "reconciles a bulk conflict attributed to the active Unique Key by $label",
    ({ metadata, message }) =>
      Effect.gen(function* intendedBulkConflict() {
        const writeError = new WriteError({
          code: 11_000,
          index: 0,
          errmsg: message,
          errInfo: metadata,
          op: {},
        });

        const result = new NativeBulkWriteResult(
          {
            ok: 1,
            nInserted: 0,
            nUpserted: 1,
            nMatched: 0,
            nModified: 0,
            nRemoved: 0,
            upserted: [{ index: 1, _id: new ObjectId() }],
            insertedIds: [],
            writeErrors: [writeError],
            writeConcernErrors: [],
          },
          false,
        );

        const native = new MongoBulkWriteError(
          { message, code: 11_000, writeErrors: [writeError] },
          result,
        );

        ctx.mockCollection.bulkWrite.mockRejectedValueOnce(native);
        ctx.mockCollection.find.mockReturnValue(
          fromPartial<ReturnType<typeof ctx.mockCollection.find>>({
            toArray: async () => await Promise.resolve([{ name: "work", uniqueKey: "shared" }]),
          }),
        );
        expect(
          yield* intake.enqueueMany([
            { name: "work", uniqueKey: "shared", data: {} },
            { name: "work", uniqueKey: "shared", data: {}, runAt: new Date(1000) },
          ]),
        ).toStrictEqual({ insertedCount: 1, deduplicatedCount: 1 });
        expect(ctx.notifyPendingJob).toHaveBeenCalledExactlyOnceWith("work", new Date(1000));
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

vi.mock(import("mongodb"), async (importOriginal) => {
  const actual = await importOriginal();
  const realCalculateObjectSize = actual.BSON.calculateObjectSize;

  return {
    ...actual,
    BSON: {
      ...actual.BSON,
      calculateObjectSize: vi.fn<typeof actual.BSON.calculateObjectSize>(
        (...args: Parameters<typeof actual.BSON.calculateObjectSize>) =>
          realCalculateObjectSize(...args),
      ),
    },
  };
});

describe("payload size validation", () => {
  afterEach(() => {
    vi.mocked(BSON.calculateObjectSize).mockClear();
  });

  it.effect("rejects payload exceeding maxPayloadSize on enqueue", () =>
    Effect.gen(function* payloadSize() {
      const ctx = createMockContext();
      ctx.options.maxPayloadSize = 100;
      const intake = makeNativeJobIntake(ctx);
      const largeData = { content: "x".repeat(200) };
      const error = yield* Effect.flip(intake.enqueue("test-job", largeData));
      expect(error).toBeInstanceOf(PayloadTooLargeError);
      expect(fromAny<PayloadTooLargeError, unknown>(error).actualSize).toBeGreaterThan(100);
      expect(fromAny<PayloadTooLargeError, unknown>(error).maxSize).toBe(100);
    }),
  );

  it.effect("allows payload within maxPayloadSize on enqueue", () =>
    Effect.gen(function* payloadSize() {
      const ctx = createMockContext();
      ctx.options.maxPayloadSize = 10_000;
      const intake = makeNativeJobIntake(ctx);
      const insertedId = new ObjectId();
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
      const result = yield* intake.enqueue("test-job", { small: "data" });
      expect(result._id).toStrictEqual(insertedId);
    }),
  );

  it.effect("allows payload exactly equal to maxPayloadSize on enqueue", () =>
    Effect.gen(function* payloadSize() {
      const ctx = createMockContext();
      const intake = makeNativeJobIntake(ctx);
      const testData = { key: "value" };
      const exactSize = BSON.calculateObjectSize({ data: testData });
      ctx.options.maxPayloadSize = exactSize;
      const insertedId = new ObjectId();
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
      const result = yield* intake.enqueue("test-job", testData);
      expect(result._id).toStrictEqual(insertedId);
    }),
  );

  it.effect("skips validation when maxPayloadSize is undefined", () =>
    Effect.gen(function* payloadSize() {
      const ctx = createMockContext();
      expect(ctx.options.maxPayloadSize).toBeUndefined();
      const intake = makeNativeJobIntake(ctx);
      const insertedId = new ObjectId();
      vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
        insertedId,
        acknowledged: true,
      });
      const largeData = { content: "x".repeat(10_000) };
      const result = yield* intake.enqueue("test-job", largeData);
      expect(result._id).toStrictEqual(insertedId);
    }),
  );

  it.effect("rejects payload exceeding maxPayloadSize on schedule", () =>
    Effect.gen(function* payloadSize() {
      const ctx = createMockContext();
      ctx.options.maxPayloadSize = 100;
      const intake = makeNativeJobIntake(ctx);
      const largeData = { content: "x".repeat(200) };
      expect(
        yield* Effect.flip(intake.schedule("0 * * * *", "test-job", largeData)),
      ).toBeInstanceOf(PayloadTooLargeError);
    }),
  );

  it.effect("wraps BSON calculation errors in PayloadTooLargeError", () =>
    Effect.gen(function* payloadSize() {
      const ctx = createMockContext();
      ctx.options.maxPayloadSize = 1000;
      const intake = makeNativeJobIntake(ctx);
      const bsonError = new Error("Cannot serialize circular structure");
      vi.mocked(BSON.calculateObjectSize).mockImplementationOnce(() => {
        throw bsonError;
      });
      const error = yield* Effect.flip(intake.enqueue("test-job", { x: 1 }));
      expect(error).toBeInstanceOf(PayloadTooLargeError);
      expect({
        fromAnyPayloadTooLargeErrorUnknownErrorActualSize: fromAny<PayloadTooLargeError, unknown>(
          error,
        ).actualSize,
        fromAnyPayloadTooLargeErrorUnknownErrorMaxSize: fromAny<PayloadTooLargeError, unknown>(
          error,
        ).maxSize,
      }).toStrictEqual({
        fromAnyPayloadTooLargeErrorUnknownErrorActualSize: -1,
        fromAnyPayloadTooLargeErrorUnknownErrorMaxSize: 1000,
      });
      expect(fromAny<PayloadTooLargeError, unknown>(error).message).toMatch(
        /Failed to calculate job payload size/u,
      );
      expect(fromAny<PayloadTooLargeError, unknown>(error).cause).toBe(bsonError);
    }),
  );

  it.effect("wraps non-Error BSON throws in a normalized cause", () =>
    Effect.gen(function* payloadSize() {
      const ctx = createMockContext();
      ctx.options.maxPayloadSize = 1000;
      const intake = makeNativeJobIntake(ctx);
      vi.mocked(BSON.calculateObjectSize).mockImplementationOnce(() => {
        // oxlint-disable-next-line eslint/no-throw-literal, typescript/only-throw-error -- Exercise native JavaScript non-Error throws at the BSON boundary.
        throw "unexpected string thrown";
      });
      const error = yield* Effect.flip(intake.enqueue("test-job", { x: 1 }));
      expect(error).toBeInstanceOf(PayloadTooLargeError);
      expect(fromAny<PayloadTooLargeError, unknown>(error).cause).toBeInstanceOf(Error);
      expect(
        fromAny<Error, unknown>(fromAny<PayloadTooLargeError, unknown>(error).cause).message,
      ).toBe("unexpected string thrown");
    }),
  );
});
