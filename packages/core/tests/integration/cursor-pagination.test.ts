import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { CursorDirection, JobCursorSortDirection, JobCursorSortField, JobStatus } from "@/jobs";
import { Monque } from "@/scheduler";
import { InvalidCursorError } from "@/shared";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
} from "@test-utils/test-utils";
import { JobFactory } from "@tests/factories";

const createJobs = async (
  db: Db,
  collectionName: string,
  count: number,
  name = "pagination-test",
) => {
  const jobs = JobFactory.buildList(count, { name });
  const jobsWithIndex = jobs.map((job, i) => {
    const { _id, ...rest } = job;
    return { ...rest, data: { index: i } };
  });
  await db.collection(collectionName).insertMany(jobsWithIndex);
  return jobsWithIndex;
};
describe("Management APIs: Cursor Pagination", () => {
  let db: Db;
  let monque: Monque;
  const monqueInstances: Monque[] = [];
  const queueName = "pagination-queue";
  beforeAll(async () => {
    db = await getTestDb("pagination-api");
  });

  afterEach(async () => {
    await stopMonqueInstances(monqueInstances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });
  describe("getJobsWithCursor", () => {
    it("summary pages omit payloads and share full listing cursors", async () => {
      const collectionName = uniqueCollectionName("pagination_summary");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      await createJobs(db, collectionName, 5, queueName);
      const full = await monque.getJobsWithCursor({ limit: 2 });
      const summary = await monque.getJobSummariesWithCursor({ limit: 2 });
      expect(summary).toStrictEqual({
        ...full,
        jobs: full.jobs.map(({ data: _data, ...job }) => job),
      });
      expect(summary.jobs.every((job) => !("data" in job))).toBe(true);
      if (summary.cursor === null) {
        throw new Error("Expected cursor");
      }
      const next = await monque.getJobsWithCursor({ limit: 2, cursor: summary.cursor });
      expect(next.jobs[0]?.data).toStrictEqual({ index: 2 });
      const indexes = await db.collection(collectionName).indexes();
      expect(indexes.map((index) => index.key)).toStrictEqual(
        expect.arrayContaining([
          { name: 1, createdAt: -1, _id: -1 },
          { status: 1, createdAt: -1, _id: -1 },
        ]),
      );
    });

    it("returns first page with cursor and hasNextPage", async () => {
      const collectionName = uniqueCollectionName("pagination_first");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Create 11 jobs, request limit 5
      await createJobs(db, collectionName, 11, queueName);
      const result = await monque.getJobsWithCursor({ limit: 5 });
      expect({
        resultJobs: result.jobs.length,
        resultHasNextPage: result.hasNextPage,
        resultHasPreviousPage: result.hasPreviousPage,
      }).toStrictEqual({
        resultJobs: 5,
        resultHasNextPage: true,
        resultHasPreviousPage: false,
      });
      expect(result.cursor).not.toBeNull();
      // Verify jobs are returned in order (oldest first by default / _id)
      expect({
        resultJobs0Data: result.jobs[0]?.data,
        resultJobs4Data: result.jobs[4]?.data,
      }).toStrictEqual({
        resultJobs0Data: { index: 0 },
        resultJobs4Data: { index: 4 },
      });
    });

    it("pagination continues correctly with cursor", async () => {
      const collectionName = uniqueCollectionName("pagination_next");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      await createJobs(db, collectionName, 10, queueName);
      // Page 1
      const page1 = await monque.getJobsWithCursor({ limit: 3 });
      expect({
        hasCursor: page1.cursor !== null,
        page1Jobs: page1.jobs.length,
        page1Jobs0Data: page1.jobs[0]?.data,
      }).toStrictEqual({
        hasCursor: true,
        page1Jobs: 3,
        page1Jobs0Data: { index: 0 },
      });
      if (page1.cursor === null) {
        throw new Error("Cursor should not be null");
      }
      // Page 2
      const page2 = await monque.getJobsWithCursor({
        limit: 3,
        cursor: page1.cursor,
      });
      expect({
        hasCursor: page2.cursor !== null,
        page2Jobs: page2.jobs.length,
        page2Jobs0Data: page2.jobs[0]?.data,
        page2HasNextPage: page2.hasNextPage,
        page2HasPreviousPage: page2.hasPreviousPage,
      }).toStrictEqual({
        hasCursor: true,
        page2Jobs: 3,
        page2Jobs0Data: { index: 3 },
        page2HasNextPage: true,
        page2HasPreviousPage: true,
      });
      if (page2.cursor === null) {
        throw new Error("Cursor should not be null");
      }
      // Page 3
      const page3 = await monque.getJobsWithCursor({
        limit: 3,
        cursor: page2.cursor,
      });
      expect({
        hasCursor: page3.cursor !== null,
        page3Jobs: page3.jobs.length,
        page3Jobs0Data: page3.jobs[0]?.data,
      }).toStrictEqual({
        hasCursor: true,
        page3Jobs: 3,
        page3Jobs0Data: { index: 6 },
      });
      if (page3.cursor === null) {
        throw new Error("Cursor should not be null");
      }
      // Page 4 (last item)
      const page4 = await monque.getJobsWithCursor({
        limit: 3,
        cursor: page3.cursor,
      });
      expect({
        page4Jobs: page4.jobs.length,
        page4Jobs0Data: page4.jobs[0]?.data,
        page4HasNextPage: page4.hasNextPage,
      }).toStrictEqual({
        page4Jobs: 1,
        page4Jobs0Data: { index: 9 },
        page4HasNextPage: false,
      });
    });

    it("supports backward pagination", async () => {
      const collectionName = uniqueCollectionName("pagination_back");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      await createJobs(db, collectionName, 10, queueName);
      const page1 = await monque.getJobsWithCursor({ limit: 3 });
      expect(page1.cursor).not.toBeNull();
      if (page1.cursor === null) {
        throw new Error("Cursor should not be null");
      }
      const page2 = await monque.getJobsWithCursor({ limit: 3, cursor: page1.cursor });
      expect(page2.cursor).not.toBeNull();
      if (page2.cursor === null) {
        throw new Error("Cursor should not be null");
      }
      // Now go backwards from page2's cursor
      const backResult = await monque.getJobsWithCursor({
        limit: 3,
        cursor: page2.cursor,
        direction: CursorDirection.BACKWARD,
      });
      // Check standard backward pagination result: items before the cursor in reverse order (so index 2, 3, 4)
      // Can go forward
      // Can go backward (0, 1 exist)
      expect({
        backResultJobs: backResult.jobs.length,
        backResultJobs0Data: backResult.jobs[0]?.data,
        backResultJobs1Data: backResult.jobs[1]?.data,
        backResultJobs2Data: backResult.jobs[2]?.data,
        backResultHasNextPage: backResult.hasNextPage,
        backResultHasPreviousPage: backResult.hasPreviousPage,
      }).toStrictEqual({
        backResultJobs: 3,
        backResultJobs0Data: { index: 2 },
        backResultJobs1Data: { index: 3 },
        backResultJobs2Data: { index: 4 },
        backResultHasNextPage: true,
        backResultHasPreviousPage: true,
      });
      if (backResult.cursor === null) {
        throw new Error("Expected backward cursor");
      }
      const earlier = await monque.getJobsWithCursor({
        limit: 3,
        cursor: backResult.cursor,
        direction: CursorDirection.BACKWARD,
      });
      expect({
        earlierJobsMapJobJobData: earlier.jobs.map((job) => job.data),
        earlierHasPreviousPage: earlier.hasPreviousPage,
      }).toStrictEqual({
        earlierJobsMapJobJobData: [{ index: 0 }, { index: 1 }],
        earlierHasPreviousPage: false,
      });
    });

    it("filters by status works with pagination", async () => {
      const collectionName = uniqueCollectionName("pagination_filter");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const pendingJobs = JobFactory.buildList(5, {
        name: queueName,
        status: JobStatus.PENDING,
      }).map((job, i) => {
        const { _id, ...rest } = job;
        return { ...rest, data: { i } };
      });
      const completedJobs = JobFactory.buildList(5, {
        name: queueName,
        status: JobStatus.COMPLETED,
      }).map((job, i) => {
        const { _id, ...rest } = job;
        return { ...rest, data: { i: i + 5 } };
      });
      await db.collection(collectionName).insertMany([...pendingJobs, ...completedJobs]);
      const result = await monque.getJobsWithCursor({
        filter: { status: JobStatus.COMPLETED },
        limit: 3,
      });
      expect({
        resultJobs: result.jobs.length,
        resultJobsEveryJJStatusJobStatusCOMPLETED: result.jobs.every(
          (j) => j.status === JobStatus.COMPLETED,
        ),
        resultHasNextPage: result.hasNextPage,
      }).toStrictEqual({
        resultJobs: 3,
        resultJobsEveryJJStatusJobStatusCOMPLETED: true,
        resultHasNextPage: true,
      });
    });

    it("invalid cursor throws error", async () => {
      const collectionName = uniqueCollectionName("pagination_invalid");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      await expect(monque.getJobsWithCursor({ cursor: "invalid-base64" })).rejects.toThrow(
        InvalidCursorError,
      );
    });

    it("handles large dataset efficiently", async () => {
      const collectionName = uniqueCollectionName("pagination_large");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      // Insert 1000 docs directly
      const largeDocs = JobFactory.buildList(1000, {
        name: queueName,
        status: JobStatus.PENDING,
      }).map((job, i) => {
        const { _id, ...rest } = job;
        return { ...rest, data: { index: i } };
      });
      await db.collection(collectionName).insertMany(largeDocs);
      const start = performance.now();
      const result = await monque.getJobsWithCursor({ limit: 100 });
      const duration = performance.now() - start;
      expect(result.jobs).toHaveLength(100);
      // Should be very fast (usually < 50ms)
      expect(duration).toBeLessThan(500);
    });

    it("keeps cursor pagination stable for duplicate primary sort values", async () => {
      const collectionName = uniqueCollectionName("pagination_stable_sort");
      monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const jobs = [
        JobFactory.build({
          _id: new ObjectId("000000000000000000000001"),
          name: queueName,
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
        JobFactory.build({
          _id: new ObjectId("000000000000000000000002"),
          name: queueName,
          updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        }),
        JobFactory.build({
          _id: new ObjectId("000000000000000000000003"),
          name: queueName,
          updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        }),
        JobFactory.build({
          _id: new ObjectId("000000000000000000000004"),
          name: queueName,
          updatedAt: new Date("2026-03-01T00:00:00.000Z"),
        }),
      ].map((job) => {
        const { _id, ...rest } = job;
        return {
          _id,
          ...rest,
        };
      });
      await db.collection(collectionName).insertMany(jobs);
      const page1 = await monque.getJobsWithCursor({
        limit: 2,
        sort: {
          by: JobCursorSortField.UPDATED_AT,
          direction: JobCursorSortDirection.DESC,
        },
      });
      expect(page1.jobs.map((job) => job._id.toHexString())).toStrictEqual([
        "000000000000000000000004",
        "000000000000000000000003",
      ]);
      expect(page1.cursor).not.toBeNull();
      if (page1.cursor === null) {
        throw new Error("Cursor should not be null");
      }
      const page2 = await monque.getJobsWithCursor({
        limit: 2,
        cursor: page1.cursor,
        sort: {
          by: JobCursorSortField.UPDATED_AT,
          direction: JobCursorSortDirection.DESC,
        },
      });
      expect(page2.jobs.map((job) => job._id.toHexString())).toStrictEqual([
        "000000000000000000000002",
        "000000000000000000000001",
      ]);
      if (page2.cursor === null) {
        throw new Error("Expected cursor");
      }
      const back = await monque.getJobSummariesWithCursor({
        limit: 2,
        cursor: page2.cursor,
        direction: CursorDirection.BACKWARD,
        sort: { by: JobCursorSortField.UPDATED_AT, direction: JobCursorSortDirection.DESC },
      });
      expect(back.jobs.map((job) => job._id.toHexString())).toStrictEqual([
        "000000000000000000000003",
        "000000000000000000000002",
      ]);
      if (back.cursor === null) {
        throw new Error("Expected backward cursor");
      }
      const earlier = await monque.getJobSummariesWithCursor({
        limit: 2,
        cursor: back.cursor,
        direction: CursorDirection.BACKWARD,
        sort: { by: JobCursorSortField.UPDATED_AT, direction: JobCursorSortDirection.DESC },
      });
      expect(earlier.jobs.map((job) => job._id.toHexString())).toStrictEqual([
        "000000000000000000000004",
      ]);
    });
  });
});
