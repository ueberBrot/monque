/**
 * Tests for the getJobs() and getJob() methods of the Monque scheduler.
 *
 * These tests verify:
 * - Basic job querying functionality
 * - Filtering by name, status, and combinations
 * - Pagination with limit and skip
 * - Single job lookup by ID
 * - Error handling for uninitialized scheduler
 *
 * @see {@link ../../src/scheduler/monque.ts}
 */
import type { Collection, Db } from "mongodb";
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

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
import { JobFactory, JobFactoryHelpers } from "@tests/factories/job.factory.js";
/** Test-specific job names to avoid collision */
const JOB_NAMES = {
  EMAIL: "send-email",
  REPORT: "generate-report",
  SYNC: "sync-data",
} as const;
describe("getJobs()", () => {
  let db: Db;
  let collectionName: string;
  let collection: Collection;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("inspection-getJobs");
  });

  beforeEach(() => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    collection = db.collection(collectionName);
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
  describe("basic querying", () => {
    it("should return all jobs when no filter is provided", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const seedJobs = [
        JobFactory.build({ name: JOB_NAMES.EMAIL }),
        JobFactory.build({ name: JOB_NAMES.REPORT }),
        JobFactory.build({ name: JOB_NAMES.SYNC }),
      ];
      await collection.insertMany(seedJobs);
      const jobs = await monque.getJobs();
      expect(jobs).toHaveLength(3);
    });

    it("should return empty array when no jobs exist", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const jobs = await monque.getJobs();
      expect({
        jobs: jobs.length,
        jobs2: jobs,
      }).toStrictEqual({
        jobs: 0,
        jobs2: [],
      });
    });

    it("should return jobs ordered by nextRunAt ascending", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const now = Date.now();
      const seedJobs = [
        JobFactory.build({
          name: JOB_NAMES.EMAIL,
          data: { order: 3 },
          nextRunAt: new Date(now + 3000),
        }),
        JobFactory.build({
          name: JOB_NAMES.EMAIL,
          data: { order: 1 },
          nextRunAt: new Date(now + 1000),
        }),
        JobFactory.build({
          name: JOB_NAMES.EMAIL,
          data: { order: 2 },
          nextRunAt: new Date(now + 2000),
        }),
      ];
      await collection.insertMany(seedJobs);
      const jobs = await monque.getJobs<{
        order: number;
      }>();
      expect({
        jobs0DataOrder: jobs[0]?.data.order,
        jobs1DataOrder: jobs[1]?.data.order,
        jobs2DataOrder: jobs[2]?.data.order,
      }).toStrictEqual({
        jobs0DataOrder: 1,
        jobs1DataOrder: 2,
        jobs2DataOrder: 3,
      });
    });

    it("should return PersistedJob with _id", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const seedJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
      await collection.insertOne(seedJob);
      const jobs = await monque.getJobs();
      expect(jobs[0]?._id).toBeInstanceOf(ObjectId);
      expect({
        jobs0Name: jobs[0]?.name,
        jobs0Status: jobs[0]?.status,
      }).toStrictEqual({
        jobs0Name: JOB_NAMES.EMAIL,
        jobs0Status: JobStatus.PENDING,
      });
    });
  });
  describe("filter by name", () => {
    it("should filter jobs by name", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const seedJobs = [
        JobFactory.build({ name: JOB_NAMES.EMAIL }),
        JobFactory.build({ name: JOB_NAMES.EMAIL }),
        JobFactory.build({ name: JOB_NAMES.REPORT }),
      ];
      await collection.insertMany(seedJobs);
      const emailJobs = await monque.getJobs({ name: JOB_NAMES.EMAIL });
      expect({
        emailJobs: emailJobs.length,
        emailJobsEveryJJNameJOBNAMESEMAIL: emailJobs.every((j) => j.name === JOB_NAMES.EMAIL),
      }).toStrictEqual({
        emailJobs: 2,
        emailJobsEveryJJNameJOBNAMESEMAIL: true,
      });
    });

    it("should return empty when name does not match any jobs", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const seedJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
      await collection.insertOne(seedJob);
      const jobs = await monque.getJobs({ name: "non-existent-job" });
      expect(jobs).toHaveLength(0);
    });
  });
  describe("filter by status", () => {
    it("should filter jobs by single status", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const pendingJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
      const completedJob = JobFactoryHelpers.completed({ name: JOB_NAMES.REPORT });
      await collection.insertMany([pendingJob, completedJob]);
      const pendingJobs = await monque.getJobs({ status: JobStatus.PENDING });
      const completedJobs = await monque.getJobs({ status: JobStatus.COMPLETED });
      expect({
        pendingJobs: pendingJobs.length,
        pendingJobs0Status: pendingJobs[0]?.status,
        completedJobs: completedJobs.length,
        completedJobs0Status: completedJobs[0]?.status,
      }).toStrictEqual({
        pendingJobs: 1,
        pendingJobs0Status: JobStatus.PENDING,
        completedJobs: 1,
        completedJobs0Status: JobStatus.COMPLETED,
      });
    });

    it("should filter jobs by multiple statuses", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const pendingJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
      const completedJob = JobFactoryHelpers.completed({ name: JOB_NAMES.REPORT });
      const failedJob = JobFactoryHelpers.failed({ name: JOB_NAMES.SYNC });
      await collection.insertMany([pendingJob, completedJob, failedJob]);
      const finishedJobs = await monque.getJobs({
        status: [JobStatus.COMPLETED, JobStatus.FAILED],
      });
      expect({
        finishedJobs: finishedJobs.length,
        finishedJobsSomeJJStatusJobStatusCOMPLETED: finishedJobs.some(
          (j) => j.status === JobStatus.COMPLETED,
        ),
        finishedJobsSomeJJStatusJobStatusFAILED: finishedJobs.some(
          (j) => j.status === JobStatus.FAILED,
        ),
      }).toStrictEqual({
        finishedJobs: 2,
        finishedJobsSomeJJStatusJobStatusCOMPLETED: true,
        finishedJobsSomeJJStatusJobStatusFAILED: true,
      });
    });
  });
  describe("pagination", () => {
    it("should limit results with limit option", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const seedJobs = JobFactory.buildList(10, { name: JOB_NAMES.EMAIL });
      await collection.insertMany(seedJobs);
      const resultJobs = await monque.getJobs({ limit: 5 });
      expect(resultJobs).toHaveLength(5);
    });

    it("should skip results with skip option", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const now = Date.now();
      const seedJobs = Array.from({ length: 5 }, (_, i) =>
        JobFactory.build({
          name: JOB_NAMES.EMAIL,
          data: { index: i },
          nextRunAt: new Date(now + i * 1000),
        }),
      );
      await collection.insertMany(seedJobs);
      const resultJobs = await monque.getJobs<{
        index: number;
      }>({ skip: 2 });
      expect({
        resultJobs: resultJobs.length,
        resultJobs0DataIndex: resultJobs[0]?.data.index,
        resultJobs1DataIndex: resultJobs[1]?.data.index,
        resultJobs2DataIndex: resultJobs[2]?.data.index,
      }).toStrictEqual({
        resultJobs: 3,
        resultJobs0DataIndex: 2,
        resultJobs1DataIndex: 3,
        resultJobs2DataIndex: 4,
      });
    });

    it("should support pagination with limit and skip", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const now = Date.now();
      const seedJobs = Array.from({ length: 10 }, (_, i) =>
        JobFactory.build({
          name: JOB_NAMES.EMAIL,
          data: { index: i },
          nextRunAt: new Date(now + i * 1000),
        }),
      );
      await collection.insertMany(seedJobs);
      const page1 = await monque.getJobs<{
        index: number;
      }>({ limit: 3, skip: 0 });
      const page2 = await monque.getJobs<{
        index: number;
      }>({ limit: 3, skip: 3 });
      const page3 = await monque.getJobs<{
        index: number;
      }>({ limit: 3, skip: 6 });
      expect({
        page1: page1.length,
        page10DataIndex: page1[0]?.data.index,
        page2: page2.length,
        page20DataIndex: page2[0]?.data.index,
        page3: page3.length,
        page30DataIndex: page3[0]?.data.index,
      }).toStrictEqual({
        page1: 3,
        page10DataIndex: 0,
        page2: 3,
        page20DataIndex: 3,
        page3: 3,
        page30DataIndex: 6,
      });
    });

    it("should default limit to 100", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const seedJobs = JobFactory.buildList(105, { name: JOB_NAMES.EMAIL });
      await collection.insertMany(seedJobs);
      const resultJobs = await monque.getJobs();
      expect(resultJobs).toHaveLength(100);
    });
  });
  describe("combined filters", () => {
    it("should combine name and status filters", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const pendingEmail = JobFactory.build({ name: JOB_NAMES.EMAIL });
      const completedEmail = JobFactoryHelpers.completed({ name: JOB_NAMES.EMAIL });
      const pendingReport = JobFactory.build({ name: JOB_NAMES.REPORT });
      await collection.insertMany([pendingEmail, completedEmail, pendingReport]);
      const pendingEmails = await monque.getJobs({
        name: JOB_NAMES.EMAIL,
        status: JobStatus.PENDING,
      });
      expect({
        pendingEmails: pendingEmails.length,
        pendingEmails0Name: pendingEmails[0]?.name,
        pendingEmails0Status: pendingEmails[0]?.status,
      }).toStrictEqual({
        pendingEmails: 1,
        pendingEmails0Name: JOB_NAMES.EMAIL,
        pendingEmails0Status: JobStatus.PENDING,
      });
    });

    it("should combine all filters", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const now = Date.now();
      const emailJobs = Array.from({ length: 10 }, (_, i) =>
        JobFactory.build({
          name: JOB_NAMES.EMAIL,
          data: { index: i },
          nextRunAt: new Date(now + i * 1000),
        }),
      );
      const reportJob = JobFactory.build({ name: JOB_NAMES.REPORT });
      await collection.insertMany([...emailJobs, reportJob]);
      const jobs = await monque.getJobs<{
        index: number;
      }>({
        name: JOB_NAMES.EMAIL,
        status: JobStatus.PENDING,
        limit: 3,
        skip: 2,
      });
      expect({
        jobs: jobs.length,
        jobs0DataIndex: jobs[0]?.data.index,
        jobsEveryJJNameJOBNAMESEMAIL: jobs.every((j) => j.name === JOB_NAMES.EMAIL),
      }).toStrictEqual({
        jobs: 3,
        jobs0DataIndex: 2,
        jobsEveryJJNameJOBNAMESEMAIL: true,
      });
    });
  });
  describe("error handling", () => {
    it("should throw when not initialized", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await expect(monque.getJobs()).rejects.toThrow("not initialized");
    });
  });
});
describe("getJob()", () => {
  let db: Db;
  let collectionName: string;
  let collection: Collection;
  const monqueInstances: Monque[] = [];
  beforeAll(async () => {
    db = await getTestDb("inspection-getJob");
  });

  beforeEach(() => {
    collectionName = uniqueCollectionName(TEST_CONSTANTS.COLLECTION_NAME);
    collection = db.collection(collectionName);
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
  describe("basic lookup", () => {
    it("should return job by ObjectId", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const seedJob = JobFactory.build({ name: JOB_NAMES.EMAIL });
      await collection.insertOne(seedJob);
      const job = await monque.getJob(seedJob._id);
      expect(job).not.toBeNull();
      expect(job?._id.toString()).toBe(seedJob._id.toString());
      expect(job?.name).toBe(JOB_NAMES.EMAIL);
    });

    it("should return null for non-existent job", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const nonExistentId = new ObjectId();
      const job = await monque.getJob(nonExistentId);
      expect(job).toBeNull();
    });

    it("should return job with all fields", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      const futureDate = new Date(Date.now() + 60_000);
      const seedJob = JobFactory.build({
        name: JOB_NAMES.EMAIL,
        nextRunAt: futureDate,
        uniqueKey: "test-unique-key",
      });
      await collection.insertOne(seedJob);
      const job = await monque.getJob(seedJob._id);
      expect({
        hasObjectId: job?._id instanceof ObjectId,
        hasCreationDate: job?.createdAt instanceof Date,
        hasUpdateDate: job?.updatedAt instanceof Date,
      }).toStrictEqual({ hasObjectId: true, hasCreationDate: true, hasUpdateDate: true });
      expect({
        jobName: job?.name,
        jobStatus: job?.status,
      }).toStrictEqual({
        jobName: JOB_NAMES.EMAIL,
        jobStatus: JobStatus.PENDING,
      });
      expect(job?.nextRunAt.getTime()).toBe(futureDate.getTime());
      expect({
        jobUniqueKey: job?.uniqueKey,
        jobFailCount: job?.failCount,
      }).toStrictEqual({
        jobUniqueKey: "test-unique-key",
        jobFailCount: 0,
      });
    });
  });
  describe("type safety", () => {
    it("should preserve generic type for job data", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      await monque.initialize();
      interface EmailJobData {
        to: string;
        subject: string;
      }
      const seedJob = JobFactoryHelpers.withData<EmailJobData>(
        { to: "test@example.com", subject: "Hello" },
        { name: JOB_NAMES.EMAIL },
      );
      await collection.insertOne(seedJob);
      const job = await monque.getJob<EmailJobData>(seedJob._id);
      expect({
        jobDataTo: job?.data.to,
        jobDataSubject: job?.data.subject,
      }).toStrictEqual({
        jobDataTo: "test@example.com",
        jobDataSubject: "Hello",
      });
    });
  });
  describe("error handling", () => {
    it("should throw when not initialized", async () => {
      const monque = new Monque(db, { collectionName });
      monqueInstances.push(monque);
      const someId = new ObjectId();
      await expect(monque.getJob(someId)).rejects.toThrow("not initialized");
    });
  });
});
