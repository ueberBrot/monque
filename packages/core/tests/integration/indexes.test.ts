/**
 * Tests for MongoDB index creation and query performance.
 *
 * These tests verify:
 * - All required indexes are created on initialization
 * - Indexes for atomic claim pattern (claimedBy+status, lastHeartbeat+status)
 * - Compound indexes for atomic claim queries (status+nextRunAt+claimedBy)
 * - Expanded recovery index (status+lockedAt+lastHeartbeat)
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { JobStatus } from "@/jobs";
import { Monque } from "@/scheduler";
import { TEST_CONSTANTS } from "@test-utils/constants.js";
import {
  cleanupTestDb,
  clearCollection,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
} from "@test-utils/test-utils.js";
import { JobFactoryHelpers } from "@tests/factories/job.factory.js";
import { arrayContainingMatcher } from "@tests/setup/matchers.js";

import { readExplanation } from "./mongo-observations";

describe("Index creation", () => {
  let db: Db;
  let collectionName: string;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("indexes");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
    if (collectionName) {
      await clearCollection(db, collectionName);
    }
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });
  describe("required indexes", () => {
    it("should create all required indexes on initialization", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection(collectionName);
      const indexes = await collection.indexes();
      const indexKeys = indexes.map((idx) => Object.keys(idx.key).join(","));
      expect(indexKeys).toStrictEqual(
        arrayContainingMatcher([
          "status,nextRunAt",
          "name,uniqueKey",
          "name,status",
          "createdAt,_id",
          "updatedAt,_id",
          "nextRunAt,_id",
          "claimedBy,status",
          "lastHeartbeat,status",
          "name,status,nextRunAt,claimedBy",
          "status,lockedAt,lastHeartbeat",
        ]),
      );
    });

    it("should create claimedBy+status compound index for job ownership queries", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection(collectionName);
      const indexes = await collection.indexes();
      const claimedByIndex = indexes.find(
        (idx) => "claimedBy" in idx.key && "status" in idx.key && Object.keys(idx.key).length === 2,
      );
      expect(claimedByIndex).toBeDefined();
      expect({
        claimedByIndexKey: claimedByIndex?.key,
        claimedByIndexBackground: claimedByIndex?.background,
      }).toStrictEqual({
        claimedByIndexKey: { claimedBy: 1, status: 1 },
        claimedByIndexBackground: true,
      });
    });

    it("should create lastHeartbeat+status compound index for stale job detection", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection(collectionName);
      const indexes = await collection.indexes();
      const heartbeatIndex = indexes.find(
        (idx) =>
          "lastHeartbeat" in idx.key && "status" in idx.key && Object.keys(idx.key).length === 2,
      );
      expect(heartbeatIndex).toBeDefined();
      expect({
        heartbeatIndexKey: heartbeatIndex?.key,
        heartbeatIndexBackground: heartbeatIndex?.background,
      }).toStrictEqual({
        heartbeatIndexKey: { lastHeartbeat: 1, status: 1 },
        heartbeatIndexBackground: true,
      });
    });

    it("should create name+status+nextRunAt+claimedBy compound index for atomic claim queries", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection(collectionName);
      const indexes = await collection.indexes();
      const atomicClaimIndex = indexes.find(
        (idx) =>
          "name" in idx.key &&
          "status" in idx.key &&
          "nextRunAt" in idx.key &&
          "claimedBy" in idx.key &&
          Object.keys(idx.key).length === 4,
      );
      expect(atomicClaimIndex).toBeDefined();
      expect({
        atomicClaimIndexKey: atomicClaimIndex?.key,
        atomicClaimIndexBackground: atomicClaimIndex?.background,
      }).toStrictEqual({
        atomicClaimIndexKey: { name: 1, status: 1, nextRunAt: 1, claimedBy: 1 },
        atomicClaimIndexBackground: true,
      });
    });

    it("should create expanded status+lockedAt+lastHeartbeat index for recovery queries", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection(collectionName);
      const indexes = await collection.indexes();
      const recoveryIndex = indexes.find(
        (idx) =>
          "lockedAt" in idx.key &&
          "lastHeartbeat" in idx.key &&
          "status" in idx.key &&
          Object.keys(idx.key).length === 3,
      );
      expect(recoveryIndex).toBeDefined();
      expect({
        recoveryIndexKey: recoveryIndex?.key,
        recoveryIndexBackground: recoveryIndex?.background,
      }).toStrictEqual({
        recoveryIndexKey: { status: 1, lockedAt: 1, lastHeartbeat: 1 },
        recoveryIndexBackground: true,
      });
    });
  });
  describe("query performance with claimedBy+status index", () => {
    it("should use index for finding jobs by owner", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection(collectionName);
      const instanceId = "test-instance-123";
      // Insert test jobs using factory helpers
      const job1 = JobFactoryHelpers.processing({
        name: TEST_CONSTANTS.JOB_NAME,
        claimedBy: instanceId,
      });
      const job2 = JobFactoryHelpers.processing({
        name: TEST_CONSTANTS.JOB_NAME,
        claimedBy: "other-instance",
      });
      await collection.insertMany([job1, job2]);
      // Query using the index
      const explainResult = await collection
        .find({ claimedBy: instanceId, status: JobStatus.PROCESSING })
        .explain("executionStats");
      // Verify index was used (not a collection scan)
      const queryPlanner = readExplanation(explainResult).winningPlan;
      const winningPlanStr = JSON.stringify(queryPlanner);
      expect(winningPlanStr).toContain("IXSCAN");
    });
  });
  describe("query performance with lastHeartbeat+status index", () => {
    it("should use index for finding stale jobs", async () => {
      collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const collection = db.collection(collectionName);
      const staleThreshold = new Date(Date.now() - 30_000);
      // Insert test jobs using factory helpers with different heartbeat times
      const staleJob = JobFactoryHelpers.processing({
        name: "stale-job",
        // 60 seconds ago (stale)
        lastHeartbeat: new Date(Date.now() - 60_000),
      });
      const activeJob = JobFactoryHelpers.processing({
        name: "active-job",
        // Just now (not stale)
        lastHeartbeat: new Date(),
      });
      await collection.insertMany([staleJob, activeJob]);
      // Query using the index (find stale jobs)
      const explainResult = await collection
        .find({ status: JobStatus.PROCESSING, lastHeartbeat: { $lt: staleThreshold } })
        .explain("executionStats");
      // Verify index was used
      const queryPlanner = readExplanation(explainResult).winningPlan;
      const winningPlanStr = JSON.stringify(queryPlanner);
      expect(winningPlanStr).toContain("IXSCAN");
    });
  });
});
