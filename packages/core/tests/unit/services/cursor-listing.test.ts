import type { Document, WithId } from "mongodb";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  CursorDirection,
  type CursorOptions,
  JobCursorSortDirection,
  JobCursorSortField,
} from "@/jobs";
import { CursorListing } from "@/scheduler/services/cursor-listing.js";
import { ConnectionError, InvalidCursorError, InvalidJobQueryError } from "@/shared";
import { createMockContext, JobFactory } from "@tests/factories";

describe("CursorListing", () => {
  let ctx: ReturnType<typeof createMockContext>;
  let listing: CursorListing;

  beforeEach(() => {
    ctx = createMockContext();
    listing = new CursorListing(ctx);
  });

  function returnJobs(jobs: WithId<Document>[]) {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockImplementation(async () => [...jobs]),
    };
    vi.spyOn(ctx.mockCollection, "find").mockReturnValue(
      cursor as unknown as ReturnType<typeof ctx.mockCollection.find>,
    );
    return cursor;
  }

  async function issueCursor(options: CursorOptions = {}): Promise<string> {
    const page = await listing.getJobsWithCursor(options);
    if (!page.cursor) throw new Error("Expected cursor");
    return page.cursor;
  }

  describe("cursor compatibility", () => {
    it.each([
      [CursorDirection.FORWARD, "F"],
      [CursorDirection.BACKWARD, "B"],
    ] as const)("keeps the compact cursor format for %s listings", async (direction, prefix) => {
      const id = new ObjectId("507f1f77bcf86cd799439011");
      returnJobs([JobFactory.build({ _id: id })]);

      const page = await listing.getJobsWithCursor({ direction });

      expect(page.cursor).toBe(prefix + Buffer.from(id.toHexString(), "hex").toString("base64url"));
      expect(page.cursor).not.toMatch(/[+/=]/);
      expect((await listing.getJobsWithCursor({ direction })).cursor).toBe(page.cursor);
    });

    it.each([CursorDirection.FORWARD, CursorDirection.BACKWARD])(
      "reads an issued legacy cursor while traversing %s",
      async (direction) => {
        const id = new ObjectId("507f1f77bcf86cd799439011");
        returnJobs([JobFactory.build({ _id: id })]);
        const cursor = await issueCursor({ direction });

        await listing.getJobsWithCursor({ cursor, direction });

        expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
          { _id: direction === CursorDirection.FORWARD ? { $gt: id } : { $lt: id } },
          { maxTimeMS: 30_000 },
        );
      },
    );

    it("reads legacy ObjectIds whose bytes start like JSON", async () => {
      const id = new ObjectId("7b0000000000000000000000");
      returnJobs([JobFactory.build({ _id: id })]);
      const cursor = await issueCursor();

      await listing.getJobsWithCursor({ cursor });

      expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
        { _id: { $gt: id } },
        { maxTimeMS: 30_000 },
      );
    });

    it("treats an empty cursor as the first page", async () => {
      returnJobs([]);

      const page = await listing.getJobsWithCursor({ cursor: "" });

      expect(page).toEqual({
        jobs: [],
        cursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(ctx.mockCollection.find).toHaveBeenCalledWith({}, { maxTimeMS: 30_000 });
    });

    it.each([
      "XUH8fd7z4bNeZQ5AR",
      "F",
      "B",
      "F!!!InvalidBase64!!!",
      `F${Buffer.from("1234", "hex").toString("base64url")}`,
      `F${Buffer.from("{", "utf8").toString("base64url")}`,
    ])("rejects malformed cursor %s before reading Jobs", async (cursor) => {
      await expect(listing.getJobsWithCursor({ cursor })).rejects.toThrow(InvalidCursorError);
      expect(ctx.mockCollection.find).not.toHaveBeenCalled();
    });

    it("keeps structured cursor metadata and uses it for date ties", async () => {
      const id = new ObjectId("507f1f77bcf86cd799439011");
      const updatedAt = new Date("2026-02-01T12:00:00.000Z");
      const sort = {
        by: JobCursorSortField.UPDATED_AT,
        direction: JobCursorSortDirection.DESC,
      };
      returnJobs([JobFactory.build({ _id: id, updatedAt })]);
      const cursor = await issueCursor({ sort });

      expect(JSON.parse(Buffer.from(cursor.slice(1), "base64url").toString("utf8"))).toEqual({
        id: id.toHexString(),
        sort: { ...sort, value: updatedAt.toISOString() },
      });
      await listing.getJobsWithCursor({ cursor, sort });

      expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
        { $or: [{ updatedAt: { $lt: updatedAt } }, { updatedAt, _id: { $lt: id } }] },
        { maxTimeMS: 30_000 },
      );
    });

    it("round trips a structured identifier cursor for descending listings", async () => {
      const id = new ObjectId("507f1f77bcf86cd799439011");
      const sort = {
        by: JobCursorSortField.IDENTIFIER,
        direction: JobCursorSortDirection.DESC,
      };
      returnJobs([JobFactory.build({ _id: id })]);
      const cursor = await issueCursor({ sort });

      await listing.getJobsWithCursor({ cursor, sort });

      expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
        { _id: { $lt: id } },
        { maxTimeMS: 30_000 },
      );
    });

    it.each([
      { by: "finishedAt", direction: "desc", value: "2026-02-01T12:00:00.000Z" },
      { by: "updatedAt", direction: "sideways", value: "2026-02-01T12:00:00.000Z" },
      { by: "updatedAt", direction: "desc", value: "not-a-date" },
      { by: "updatedAt", direction: "desc", value: 123 },
      "updatedAt",
      null,
    ])("rejects malformed structured sort %j", async (sort) => {
      const cursor = structuredCursor({ id: "507f1f77bcf86cd799439011", sort });

      await expect(listing.getJobsWithCursor({ cursor })).rejects.toThrow(InvalidCursorError);
      expect(ctx.mockCollection.find).not.toHaveBeenCalled();
    });

    it.each(["not-an-id", 42, null])("rejects malformed structured identifier %j", async (id) => {
      const cursor = structuredCursor({
        id,
        sort: { by: "updatedAt", direction: "desc", value: "2026-02-01T12:00:00.000Z" },
      });

      await expect(listing.getJobsWithCursor({ cursor })).rejects.toThrow(InvalidCursorError);
      expect(ctx.mockCollection.find).not.toHaveBeenCalled();
    });

    it("rejects a cursor used with a different sort", async () => {
      returnJobs([JobFactory.build()]);
      const cursor = await issueCursor({
        sort: { by: JobCursorSortField.UPDATED_AT, direction: JobCursorSortDirection.DESC },
      });
      vi.mocked(ctx.mockCollection.find).mockClear();

      await expect(
        listing.getJobsWithCursor({
          cursor,
          sort: { by: JobCursorSortField.CREATED_AT, direction: JobCursorSortDirection.DESC },
        }),
      ).rejects.toThrow("Cursor does not match requested sort");
      expect(ctx.mockCollection.find).not.toHaveBeenCalled();
    });

    it("rejects a legacy cursor used with a date sort", async () => {
      returnJobs([JobFactory.build()]);
      const cursor = await issueCursor();
      vi.mocked(ctx.mockCollection.find).mockClear();

      await expect(
        listing.getJobsWithCursor({
          cursor,
          sort: { by: JobCursorSortField.CREATED_AT, direction: JobCursorSortDirection.DESC },
        }),
      ).rejects.toThrow(InvalidCursorError);
      expect(ctx.mockCollection.find).not.toHaveBeenCalled();
    });
  });

  describe("page assembly", () => {
    it("trims the extra Job before restoring backward display order", async () => {
      const jobs = JobFactory.buildList(4);
      returnJobs(jobs);

      const page = await listing.getJobsWithCursor({
        limit: 3,
        direction: CursorDirection.BACKWARD,
      });

      expect(page.jobs.map((job) => job._id)).toEqual(
        jobs
          .slice(0, 3)
          .reverse()
          .map((job) => job._id),
      );
      expect(page.hasPreviousPage).toBe(true);
      expect(page.hasNextPage).toBe(false);
      expect(page.cursor).toBe(
        "B" + Buffer.from(jobs[2]!._id.toHexString(), "hex").toString("base64url"),
      );
    });

    it("omits payloads from summary reads and shares full listing cursors", async () => {
      const job = JobFactory.build({ data: { private: "payload" } });
      returnJobs([job]);

      const full = await listing.getJobsWithCursor();
      const summary = await listing.getJobSummariesWithCursor();

      expect(summary.cursor).toBe(full.cursor);
      expect(summary.jobs[0]).not.toHaveProperty("data");
      expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
        {},
        { maxTimeMS: 30_000, projection: { data: 0 } },
      );
    });

    it.each([0, -1, 1.5, 1001, Number.NaN])(
      "rejects invalid page size %s before reading",
      async (limit) => {
        await expect(listing.getJobsWithCursor({ limit })).rejects.toThrow(InvalidJobQueryError);
        await expect(listing.getJobSummariesWithCursor({ limit })).rejects.toThrow(
          InvalidJobQueryError,
        );
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      },
    );
  });

  describe("getJobsWithCursor", () => {
    it("should return page with jobs and cursor info", async () => {
      const jobs = JobFactory.buildList(2);

      returnJobs(jobs);

      const page = await listing.getJobsWithCursor({ limit: 10 });

      expect(page.jobs).toHaveLength(2);
      expect(page.hasNextPage).toBe(false);
      expect(page.hasPreviousPage).toBe(false);
    });

    it("should throw InvalidCursorError for malformed cursor", async () => {
      await expect(listing.getJobsWithCursor({ cursor: "invalid-base64-cursor" })).rejects.toThrow(
        InvalidCursorError,
      );
    });

    it("should detect hasNextPage when more results exist", async () => {
      // Return 11 jobs when limit is 10 (fetches limit + 1 to detect next page)
      const jobs = JobFactory.buildList(11);

      returnJobs(jobs);

      const page = await listing.getJobsWithCursor({ limit: 10 });

      expect(page.jobs).toHaveLength(10); // Should trim to limit
      expect(page.hasNextPage).toBe(true);
    });

    it("should sort by whitelisted field with identifier tie-breaker", async () => {
      const jobs = JobFactory.buildList(2, {
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      });

      const mockCursor = returnJobs(jobs);

      await listing.getJobsWithCursor({
        limit: 10,
        sort: {
          by: JobCursorSortField.UPDATED_AT,
          direction: JobCursorSortDirection.DESC,
        },
        filter: {
          updatedAtFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
      });

      expect(ctx.mockCollection.find).toHaveBeenCalledWith(
        {
          updatedAt: {
            $gte: new Date("2026-01-01T00:00:00.000Z"),
          },
        },
        { maxTimeMS: 30_000 },
      );
      expect(mockCursor.sort).toHaveBeenCalledWith({
        updatedAt: -1,
        _id: -1,
      });
    });

    it("should throw ConnectionError when database operation fails", async () => {
      returnJobs([]).toArray.mockRejectedValueOnce(new Error("Database error"));

      await expect(listing.getJobsWithCursor()).rejects.toThrow(ConnectionError);
    });

    it("should wrap non-Error thrown values in ConnectionError", async () => {
      returnJobs([]).toArray.mockRejectedValueOnce("Network failure");

      await expect(listing.getJobsWithCursor()).rejects.toThrow(ConnectionError);
    });
  });
});

function structuredCursor(payload: unknown): string {
  return "F" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
