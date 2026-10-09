import { fromAny } from "@total-typescript/shoehorn";
import { Effect } from "effect";
import { BSON, ObjectId } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { JobIntake } from "@/scheduler/services/job-intake.js";
import { PayloadTooLargeError } from "@/shared";
import { createMockContext } from "@tests/factories";
// vi.mock hoisted to top of file - mock the mongodb module so we can control BSON.calculateObjectSize.
// We wrap calculateObjectSize in a vi.fn so tests can temporarily override it with mockImplementationOnce.
// The real function is captured inside importOriginal to avoid circular reference from the mock itself.
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

  it("rejects payload exceeding maxPayloadSize on enqueue", async () => {
    const ctx = createMockContext();
    ctx.options.maxPayloadSize = 100;
    const intake = new JobIntake(ctx);
    // Large data that will exceed 100 bytes in BSON
    const largeData = { content: "x".repeat(200) };
    await expect(Effect.runPromise(intake.enqueue("test-job", largeData))).rejects.toThrow(
      PayloadTooLargeError,
    );
    const error = await Effect.runPromise(Effect.flip(intake.enqueue("test-job", largeData)));
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(fromAny<PayloadTooLargeError, unknown>(error).actualSize).toBeGreaterThan(100);
    expect(fromAny<PayloadTooLargeError, unknown>(error).maxSize).toBe(100);
  });

  it("allows payload within maxPayloadSize on enqueue", async () => {
    const ctx = createMockContext();
    ctx.options.maxPayloadSize = 10_000;
    const intake = new JobIntake(ctx);
    const insertedId = new ObjectId();
    vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
      insertedId,
      acknowledged: true,
    });
    const result = await Effect.runPromise(intake.enqueue("test-job", { small: "data" }));
    expect(result._id).toStrictEqual(insertedId);
  });

  it("allows payload exactly equal to maxPayloadSize on enqueue", async () => {
    const ctx = createMockContext();
    const intake = new JobIntake(ctx);
    const testData = { key: "value" };
    // Mirror what validatePayloadSize computes: BSON.calculateObjectSize({ data })
    const exactSize = BSON.calculateObjectSize({ data: testData });
    ctx.options.maxPayloadSize = exactSize;
    const insertedId = new ObjectId();
    vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
      insertedId,
      acknowledged: true,
    });
    const result = await Effect.runPromise(intake.enqueue("test-job", testData));
    expect(result._id).toStrictEqual(insertedId);
  });

  it("skips validation when maxPayloadSize is undefined", async () => {
    const ctx = createMockContext();
    // maxPayloadSize is undefined by default
    expect(ctx.options.maxPayloadSize).toBeUndefined();
    const intake = new JobIntake(ctx);
    const insertedId = new ObjectId();
    vi.spyOn(ctx.mockCollection, "insertOne").mockResolvedValueOnce({
      insertedId,
      acknowledged: true,
    });
    // Even large data should be accepted when maxPayloadSize is undefined
    const largeData = { content: "x".repeat(10_000) };
    const result = await Effect.runPromise(intake.enqueue("test-job", largeData));
    expect(result._id).toStrictEqual(insertedId);
  });

  it("rejects payload exceeding maxPayloadSize on schedule", async () => {
    const ctx = createMockContext();
    ctx.options.maxPayloadSize = 100;
    const intake = new JobIntake(ctx);
    const largeData = { content: "x".repeat(200) };
    await expect(
      Effect.runPromise(intake.schedule("0 * * * *", "test-job", largeData)),
    ).rejects.toThrow(PayloadTooLargeError);
  });

  it("wraps BSON calculation errors in PayloadTooLargeError", async () => {
    const ctx = createMockContext();
    ctx.options.maxPayloadSize = 1000;
    const intake = new JobIntake(ctx);
    const bsonError = new Error("Cannot serialize circular structure");
    vi.mocked(BSON.calculateObjectSize).mockImplementationOnce(() => {
      throw bsonError;
    });
    const error = await Effect.runPromise(Effect.flip(intake.enqueue("test-job", { x: 1 })));
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect({
      fromAnyPayloadTooLargeErrorUnknownErrorActualSize: fromAny<PayloadTooLargeError, unknown>(
        error,
      ).actualSize,
      fromAnyPayloadTooLargeErrorUnknownErrorMaxSize: fromAny<PayloadTooLargeError, unknown>(error)
        .maxSize,
    }).toStrictEqual({
      fromAnyPayloadTooLargeErrorUnknownErrorActualSize: -1,
      fromAnyPayloadTooLargeErrorUnknownErrorMaxSize: 1000,
    });
    expect(fromAny<PayloadTooLargeError, unknown>(error).message).toMatch(
      /Failed to calculate job payload size/u,
    );
    expect(fromAny<PayloadTooLargeError, unknown>(error).cause).toBe(bsonError);
  });

  it("wraps non-Error BSON throws in a normalized cause", async () => {
    const ctx = createMockContext();
    ctx.options.maxPayloadSize = 1000;
    const intake = new JobIntake(ctx);
    vi.mocked(BSON.calculateObjectSize).mockImplementationOnce(() => {
      // oxlint-disable-next-line eslint/no-throw-literal, typescript/only-throw-error -- Exercise native JavaScript non-Error throws at the BSON boundary.
      throw "unexpected string thrown";
    });
    const error = await Effect.runPromise(Effect.flip(intake.enqueue("test-job", { x: 1 })));
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(fromAny<PayloadTooLargeError, unknown>(error).cause).toBeInstanceOf(Error);
    expect(
      fromAny<Error, unknown>(fromAny<PayloadTooLargeError, unknown>(error).cause).message,
    ).toBe("unexpected string thrown");
  });
});
