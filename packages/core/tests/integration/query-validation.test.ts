import { fromAny } from "@total-typescript/shoehorn";
import type { Db, ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";

import { InvalidJobQueryError, Monque } from "@/index";
import type { JobCursorFilter, JobSelector } from "@/index";
import { cleanupTestDb, getTestDb, uniqueCollectionName } from "@test-utils/test-utils";

interface QueryValidationOperation {
  name: string;
  run: (scheduler: Monque, filter: JobSelector) => Promise<void>;
}

const queryOperations = [
  {
    name: "getJobs",
    run: async (scheduler, filter) => {
      await scheduler.getJobs(filter);
    },
  },
  {
    name: "getJobsWithCursor",
    run: async (scheduler, filter) => {
      await scheduler.getJobsWithCursor({ filter });
    },
  },
  {
    name: "getJobSummariesWithCursor",
    run: async (scheduler, filter) => {
      await scheduler.getJobSummariesWithCursor({ filter });
    },
  },
  {
    name: "getQueueStats",
    run: async (scheduler, filter) => {
      await scheduler.getQueueStats(filter);
    },
  },
  {
    name: "getQueueViewSummaries",
    run: async (scheduler, filter) => {
      await scheduler.getQueueViewSummaries(filter);
    },
  },
  {
    name: "cancelJobs",
    run: async (scheduler, filter) => {
      await scheduler.cancelJobs(filter);
    },
  },
  {
    name: "retryJobs",
    run: async (scheduler, filter) => {
      await scheduler.retryJobs(filter);
    },
  },
  {
    name: "deleteJobs",
    run: async (scheduler, filter) => {
      await scheduler.deleteJobs(filter);
    },
  },
] satisfies QueryValidationOperation[];

describe("Public query input validation", () => {
  let db: Db;
  let monque: Monque;
  beforeAll(async () => {
    db = await getTestDb("query-validation");
    monque = new Monque(db, { collectionName: uniqueCollectionName("query_validation") });
    await monque.initialize();
  });
  beforeEach(async () => {
    await monque.deleteJobs({});
    await monque.enqueue("alpha", {});
    await monque.enqueue("beta", {});
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("rejects an empty name without broadening deletion to other Job Names", async () => {
    await expect(monque.deleteJobs({ name: "" })).rejects.toThrow(InvalidJobQueryError);
    const awaitedResult1 = await monque.getJobs();
    expect(awaitedResult1.map((job) => job.name).toSorted()).toStrictEqual(["alpha", "beta"]);
    await expect(monque.deleteJobs({ name: "alpha" })).resolves.toStrictEqual({
      count: 1,
      errors: [],
    });
    const awaitedResult2 = await monque.getJobs();
    expect(awaitedResult2.map((job) => job.name)).toStrictEqual(["beta"]);
  });

  it.each(queryOperations)(
    "rejects operator-valued selectors in $name without changing jobs",
    async ({ run }) => {
      const filter = fromAny<JobSelector, { name: { $ne: null } }>({ name: { $ne: null } });
      await expect(run(monque, filter)).rejects.toThrow(InvalidJobQueryError);
      const remainingJobs = await monque.getJobs();
      expect(remainingJobs.map((job) => job.status)).toStrictEqual(["pending", "pending"]);
    },
  );

  it.each([
    { status: { $ne: "processing" } },
    { status: [{ $regex: ".*" }] },
    { status: null },
    { status: "" },
    { status: ["pending", null] },
    { olderThan: null },
    { olderThan: { $gt: "" } },
    { newerThan: new Date(Number.NaN) },
  ])("rejects invalid status or date selectors %j without changing jobs", async (input) => {
    // Deliberately cross the TypeScript boundary, as a JavaScript/JSON caller can.
    const filter = fromAny<JobSelector, unknown>(input);
    await expect(monque.getJobs(filter)).rejects.toThrow(InvalidJobQueryError);
    await expect(monque.cancelJobs(filter)).rejects.toThrow(InvalidJobQueryError);
    await expect(monque.retryJobs(filter)).rejects.toThrow(InvalidJobQueryError);
    await expect(monque.deleteJobs(filter)).rejects.toThrow(InvalidJobQueryError);
    const awaitedResult4 = await monque.getJobs();
    expect(awaitedResult4.map((job) => job.status)).toStrictEqual(["pending", "pending"]);
  });

  it("preserves exact names, status arrays, and date bounds", async () => {
    await expect(
      monque.getJobs({ name: "alpha", status: ["pending", "failed"] }),
    ).resolves.toHaveLength(1);
    await expect(
      monque.cancelJobs({ name: "alpha", olderThan: new Date(Date.now() + 1000) }),
    ).resolves.toStrictEqual({ count: 1, errors: [] });
    await expect(monque.getJobs({ name: "beta", status: "pending" })).resolves.toHaveLength(1);
  });

  it("distinguishes an empty status selection from an intentional empty selector", async () => {
    await expect(monque.getJobs({ status: [] })).resolves.toHaveLength(0);
    await expect(monque.deleteJobs({ status: [] })).resolves.toStrictEqual({
      count: 0,
      errors: [],
    });
    await expect(monque.deleteJobs({})).resolves.toStrictEqual({ count: 2, errors: [] });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1001,
    Number.MAX_SAFE_INTEGER,
    null,
    "10",
  ])("rejects unsafe page size %s for every listing API", async (input) => {
    const options = { limit: fromAny<number, unknown>(input) };
    await expect(monque.getJobs(options)).rejects.toThrow(InvalidJobQueryError);
    await expect(monque.getJobsWithCursor(options)).rejects.toThrow(InvalidJobQueryError);
    await expect(monque.getJobSummariesWithCursor(options)).rejects.toThrow(InvalidJobQueryError);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid skip %s",
    async (skip) => {
      await expect(monque.getJobs({ skip })).rejects.toThrow(InvalidJobQueryError);
    },
  );

  it("preserves pagination defaults and supports the maximum bounded page size", async () => {
    await Promise.all(Array.from({ length: 103 }, async () => await monque.enqueue("alpha", {})));
    const defaultJobs = await monque.getJobs();
    const defaultCursorPage = await monque.getJobsWithCursor();
    expect({
      jobCount: defaultJobs.length,
      cursorJobCount: defaultCursorPage.jobs.length,
    }).toStrictEqual({ jobCount: 100, cursorJobCount: 50 });
    await expect(monque.getJobs({ limit: 1000 })).resolves.toHaveLength(105);
    const awaitedResult6 = await monque.getJobsWithCursor({ limit: 1000 });
    expect(awaitedResult6.jobs).toHaveLength(105);
    const awaitedResult7 = await monque.getJobSummariesWithCursor({ limit: 1000 });
    expect(awaitedResult7.jobs).toHaveLength(105);
    await expect(monque.getJobs({ limit: 1, skip: 104 })).resolves.toHaveLength(1);
  });

  describe.each([null, false, 0, "", []])("malformed filter %j", (input) => {
    it.each(queryOperations.filter(({ name }) => name !== "cancelJobs" && name !== "retryJobs"))(
      "rejects $name instead of reading or changing all jobs",
      async ({ run }) => {
        const filter = fromAny<JobSelector, unknown>(input);
        await expect(run(monque, filter)).rejects.toThrow(InvalidJobQueryError);
        await expect(monque.getJobs()).resolves.toHaveLength(2);
      },
    );
  });

  it("does not interpret an operator object as a single-job ID", async () => {
    const input = fromAny<ObjectId, unknown>(JSON.parse('{"$ne":null}'));
    await expect(monque.getJob(input)).resolves.toBeNull();
    const job = await monque.enqueue("gamma", {});
    const awaitedResult8 = await monque.getJob(job._id);
    expect(awaitedResult8?._id).toStrictEqual(job._id);
    const awaitedResult9 = await monque.getJob(job._id.toHexString());
    expect(awaitedResult9?._id).toStrictEqual(job._id);
  });

  describe.each(["", null, 0, [], /alpha/u])("invalid cached-statistics name %j", (input) => {
    it.each(
      queryOperations.filter(
        ({ name }) =>
          name !== "getJobSummariesWithCursor" && name !== "cancelJobs" && name !== "retryJobs",
      ),
    )("rejects $name without broadening the filter", async ({ run }) => {
      await monque.getQueueStats();
      await monque.getQueueViewSummaries();
      const filter = fromAny<JobSelector, unknown>({ name: input });
      await expect(run(monque, filter)).rejects.toThrow(InvalidJobQueryError);
      await expect(monque.getJobs()).resolves.toHaveLength(2);
    });
  });

  it.each([
    { createdAtFrom: null },
    { createdAtTo: "2026-01-01" },
    { updatedAtFrom: { $ne: null } },
    { updatedAtTo: new Date(Number.NaN) },
    { nextRunAtFrom: 0 },
    { nextRunAtTo: [] },
  ])("rejects invalid cursor date ranges %j", async (input) => {
    const filter = fromAny<JobCursorFilter, unknown>(input);
    await expect(monque.getJobsWithCursor({ filter })).rejects.toThrow(InvalidJobQueryError);
    await expect(monque.getJobSummariesWithCursor({ filter })).rejects.toThrow(
      InvalidJobQueryError,
    );
  });
});
