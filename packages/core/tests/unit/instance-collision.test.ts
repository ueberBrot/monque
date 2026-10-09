import { fromAny, fromPartial } from "@total-typescript/shoehorn";
/**
 * Unit tests for instance collision detection in Monque.initialize().
 *
 * Verifies that `checkInstanceCollision()` correctly detects active instances
 * using the same schedulerInstanceId via heartbeat staleness discrimination.
 */
import type { Collection, Db, Document, Filter, FindOptions, WithId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Monque } from "@/scheduler/monque.js";
import { ConnectionError } from "@/shared";
import { anyMatcher, objectContainingMatcher } from "@tests/setup/matchers.js";
import type { MockFunction, NativeMock } from "@tests/setup/mock-function.js";
import { nativeAsyncMock } from "@tests/setup/native-async-mock.js";

type FindOne = (
  filter: Filter<Document>,
  options?: FindOptions,
) => Promise<Partial<WithId<Document>> | null>;
// Mock the services to avoid instantiating them
vi.mock(import("@/scheduler/services/index.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    JobIntake: fromPartial<typeof actual.JobIntake>(vi.fn<typeof actual.JobIntake>()),
    JobManager: fromPartial<typeof actual.JobManager>(vi.fn<typeof actual.JobManager>()),
    JobQueryService: fromPartial<typeof actual.JobQueryService>(
      vi.fn<typeof actual.JobQueryService>(),
    ),
    JobProcessor: fromPartial<typeof actual.JobProcessor>(vi.fn<typeof actual.JobProcessor>()),
    ChangeStreamHandler: fromPartial<typeof actual.ChangeStreamHandler>(
      vi.fn<typeof actual.ChangeStreamHandler>(),
    ),
  };
});
describe("Instance Collision Detection", () => {
  let mockDb: NativeMock<Db>;
  let mockCollection: NativeMock<Collection>;
  let findOneSpy: ReturnType<typeof vi.fn<FindOne>>;
  beforeEach(() => {
    findOneSpy = vi.fn<FindOne>().mockResolvedValue(null);
    mockCollection = fromPartial<NativeMock<Collection>>({
      createIndexes: vi
        .fn<MockFunction<Collection["createIndexes"]>>()
        .mockResolvedValue(["index_name"]),
      updateMany: vi.fn<MockFunction<Collection["updateMany"]>>().mockResolvedValue({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
        upsertedId: null,
      }),
      findOne: findOneSpy,
    });
    mockDb = fromPartial<NativeMock<Db>>({
      collection: vi
        .fn<MockFunction<Db["collection"]>>()
        .mockReturnValue(fromPartial<Collection>(mockCollection)),
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("throws ConnectionError when active instance with same ID exists", async () => {
    const instanceId = "shared-instance-id";
    const monque = new Monque(fromPartial<Db>(mockDb), { schedulerInstanceId: instanceId });
    // Simulate an active job with recent heartbeat claimed by same instance
    findOneSpy.mockResolvedValue({
      name: "some-job",
      lastHeartbeat: new Date(),
      claimedBy: instanceId,
      status: "processing",
    });
    await expect(monque.initialize()).rejects.toThrow(ConnectionError);
    await expect(monque.initialize()).rejects.toThrow(/schedulerInstanceId/u);
  });

  it("includes instance ID and job name in error message", async () => {
    const instanceId = "collision-id";
    const monque = new Monque(fromPartial<Db>(mockDb), { schedulerInstanceId: instanceId });
    findOneSpy.mockResolvedValue({
      name: "email-sender",
      lastHeartbeat: new Date(),
      claimedBy: instanceId,
      status: "processing",
    });
    await expect(monque.initialize()).rejects.toThrow(/collision-id/u);
    await expect(monque.initialize()).rejects.toThrow(/email-sender/u);
  });

  it("does not throw when no active instance exists", async () => {
    const monque = new Monque(fromPartial<Db>(mockDb), { schedulerInstanceId: "unique-id" });
    // findOne returns null (no matching active jobs)
    findOneSpy.mockResolvedValue(null);
    await expect(monque.initialize()).resolves.toBeUndefined();
  });

  it("queries with correct filter shape including heartbeat threshold", async () => {
    const heartbeatInterval = 5000;
    const instanceId = "check-query-id";
    const monque = new Monque(fromPartial<Db>(mockDb), {
      schedulerInstanceId: instanceId,
      heartbeatInterval,
    });
    findOneSpy.mockResolvedValue(null);
    await monque.initialize();
    // Verify findOne was called with the collision detection query
    expect(findOneSpy).toHaveBeenCalledWith(
      objectContainingMatcher({
        claimedBy: instanceId,
        status: "processing",
        lastHeartbeat: objectContainingMatcher({
          $gte: anyMatcher(Date),
        }),
      }),
    );
    // Verify the threshold is approximately 2× heartbeatInterval ago
    const callArgs = fromAny<[{ lastHeartbeat: { $gte: Date } }], unknown>(
      findOneSpy.mock.calls[0],
    );
    const [query] = callArgs;
    const { lastHeartbeat } = query;
    const threshold = lastHeartbeat.$gte;
    const expectedThreshold = Date.now() - heartbeatInterval * 2;
    // Allow 1 second tolerance for test execution time
    expect(threshold.getTime()).toBeGreaterThan(expectedThreshold - 1000);
    expect(threshold.getTime()).toBeLessThanOrEqual(expectedThreshold + 1000);
  });

  it("does not throw when heartbeat is stale (crash recovery scenario)", async () => {
    const instanceId = "crashed-instance";
    const monque = new Monque(fromPartial<Db>(mockDb), {
      schedulerInstanceId: instanceId,
      heartbeatInterval: 1000,
    });
    // findOne returns null because MongoDB $gte filter excludes stale heartbeats
    // (stale heartbeats are older than 2× heartbeatInterval)
    findOneSpy.mockResolvedValue(null);
    await expect(monque.initialize()).resolves.toBeUndefined();
  });

  it("skips collision check when collection is not initialized", async () => {
    // Create a Monque where collection setup throws before collision check
    const failingDb = fromPartial<NativeMock<Db>>({
      collection: vi.fn<MockFunction<Db["collection"]>>().mockImplementation(() => {
        throw new Error("DB unavailable");
      }),
    });
    const monque = new Monque(fromPartial<Db>(failingDb), { schedulerInstanceId: "test-id" });
    // Should throw ConnectionError from the DB failure, not from collision check
    await expect(monque.initialize()).rejects.toThrow(ConnectionError);
    // findOne should never have been called
    expect(findOneSpy).not.toHaveBeenCalled();
  });

  it("runs collision check after stale recovery", async () => {
    const instanceId = "order-check-id";
    const monque = new Monque(fromPartial<Db>(mockDb), {
      schedulerInstanceId: instanceId,
      recoverStaleJobs: true,
    });
    const callOrder: string[] = [];
    vi.mocked(mockCollection.updateMany).mockImplementation(
      nativeAsyncMock<Collection["updateMany"]>((filter) => {
        if (filter["status"] === "processing") {
          callOrder.push("recoverStaleJobs");
        }
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedCount: 0,
          upsertedId: null,
        };
      }),
    );
    findOneSpy.mockImplementation(
      nativeAsyncMock<FindOne>(() => {
        callOrder.push("findOne");
        return null;
      }),
    );
    await monque.initialize();
    // Recovery must finish before checking whether another instance is active.
    expect(callOrder).toStrictEqual(["recoverStaleJobs", "findOne"]);
  });

  it("default randomUUID instances never collide with each other", async () => {
    // Two Monque instances with default (random) IDs should not collide
    const monque1 = new Monque(fromPartial<Db>(mockDb));
    const monque2 = new Monque(fromPartial<Db>(mockDb));
    findOneSpy.mockResolvedValue(null);
    await monque1.initialize();
    await monque2.initialize();
    // findOne is called once per initialize() for the collision check
    expect(findOneSpy).toHaveBeenCalledTimes(2);
    // Verify the two instances used different claimedBy (schedulerInstanceId) values
    const call1Query = fromAny<
      {
        claimedBy: string;
      },
      unknown
    >(findOneSpy.mock.calls[0]?.[0]);
    const call2Query = fromAny<
      {
        claimedBy: string;
      },
      unknown
    >(findOneSpy.mock.calls[1]?.[0]);
    expect({
      call1QueryClaimedBy: call1Query.claimedBy,
      call2QueryClaimedBy: call2Query.claimedBy,
    }).toStrictEqual({
      call1QueryClaimedBy: anyMatcher(String),
      call2QueryClaimedBy: anyMatcher(String),
    });
    expect(call1Query.claimedBy).not.toBe(call2Query.claimedBy);
  });
});
