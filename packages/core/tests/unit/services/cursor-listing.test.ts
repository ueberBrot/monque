import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { Document, WithId } from "mongodb";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, vi } from "vite-plus/test";

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

  const issueCursor = Effect.fnUntraced(function* (options: CursorOptions = {}) {
    const page = yield* listing.getJobsWithCursor(options);
    if (!page.cursor) throw new Error("Expected cursor");
    return page.cursor;
  });

  describe("cursor compatibility", () => {
    it.effect.each([
      [CursorDirection.FORWARD, "F"],
      [CursorDirection.BACKWARD, "B"],
    ] as const)("keeps the compact cursor format for %s listings", ([direction, prefix]) =>
      Effect.gen(function* () {
        const id = new ObjectId("507f1f77bcf86cd799439011");
        returnJobs([JobFactory.build({ _id: id })]);

        const page = yield* listing.getJobsWithCursor({ direction });

        expect(page.cursor).toBe(
          prefix + Buffer.from(id.toHexString(), "hex").toString("base64url"),
        );
        expect(page.cursor).not.toMatch(/[+/=]/);
        expect((yield* listing.getJobsWithCursor({ direction })).cursor).toBe(page.cursor);
      }),
    );

    it.effect.each([CursorDirection.FORWARD, CursorDirection.BACKWARD])(
      "reads an issued legacy cursor while traversing %s",
      (direction) =>
        Effect.gen(function* () {
          const id = new ObjectId("507f1f77bcf86cd799439011");
          returnJobs([JobFactory.build({ _id: id })]);
          const cursor = yield* issueCursor({ direction });

          yield* listing.getJobsWithCursor({ cursor, direction });

          expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
            { _id: direction === CursorDirection.FORWARD ? { $gt: id } : { $lt: id } },
            { maxTimeMS: 30_000 },
          );
        }),
    );

    it.effect("reads legacy ObjectIds whose bytes start like JSON", () =>
      Effect.gen(function* () {
        const id = new ObjectId("7b0000000000000000000000");
        returnJobs([JobFactory.build({ _id: id })]);
        const cursor = yield* issueCursor();

        yield* listing.getJobsWithCursor({ cursor });

        expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
          { _id: { $gt: id } },
          { maxTimeMS: 30_000 },
        );
      }),
    );

    it.effect("treats an empty cursor as the first page", () =>
      Effect.gen(function* () {
        returnJobs([]);

        const page = yield* listing.getJobsWithCursor({ cursor: "" });

        expect(page).toEqual({
          jobs: [],
          cursor: null,
          hasNextPage: false,
          hasPreviousPage: false,
        });
        expect(ctx.mockCollection.find).toHaveBeenCalledWith({}, { maxTimeMS: 30_000 });
      }),
    );

    it.effect.each([
      "XUH8fd7z4bNeZQ5AR",
      "F",
      "B",
      "F!!!InvalidBase64!!!",
      `F${Buffer.from("1234", "hex").toString("base64url")}`,
      `F${Buffer.from("{", "utf8").toString("base64url")}`,
    ])("rejects malformed cursor %s before reading Jobs", (cursor) =>
      Effect.gen(function* () {
        expect(yield* Effect.result(listing.getJobsWithCursor({ cursor }))).toMatchObject({
          _tag: "Failure",
          failure: expect.any(InvalidCursorError),
        });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );

    it.effect("keeps structured cursor metadata and uses it for date ties", () =>
      Effect.gen(function* () {
        const id = new ObjectId("507f1f77bcf86cd799439011");
        const updatedAt = new Date("2026-02-01T12:00:00.000Z");
        const sort = {
          by: JobCursorSortField.UPDATED_AT,
          direction: JobCursorSortDirection.DESC,
        };
        returnJobs([JobFactory.build({ _id: id, updatedAt })]);
        const cursor = yield* issueCursor({ sort });

        expect(JSON.parse(Buffer.from(cursor.slice(1), "base64url").toString("utf8"))).toEqual({
          id: id.toHexString(),
          sort: { ...sort, value: updatedAt.toISOString() },
        });
        yield* listing.getJobsWithCursor({ cursor, sort });

        expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
          { $or: [{ updatedAt: { $lt: updatedAt } }, { updatedAt, _id: { $lt: id } }] },
          { maxTimeMS: 30_000 },
        );
      }),
    );

    it.effect("round trips a structured identifier cursor for descending listings", () =>
      Effect.gen(function* () {
        const id = new ObjectId("507f1f77bcf86cd799439011");
        const sort = {
          by: JobCursorSortField.IDENTIFIER,
          direction: JobCursorSortDirection.DESC,
        };
        returnJobs([JobFactory.build({ _id: id })]);
        const cursor = yield* issueCursor({ sort });

        yield* listing.getJobsWithCursor({ cursor, sort });

        expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
          { _id: { $lt: id } },
          { maxTimeMS: 30_000 },
        );
      }),
    );

    it.effect.each([
      { by: "finishedAt", direction: "desc", value: "2026-02-01T12:00:00.000Z" },
      { by: "updatedAt", direction: "sideways", value: "2026-02-01T12:00:00.000Z" },
      { by: "updatedAt", direction: "desc", value: "not-a-date" },
      { by: "updatedAt", direction: "desc", value: 123 },
      "updatedAt",
      null,
    ])("rejects malformed structured sort %j", (sort) =>
      Effect.gen(function* () {
        const cursor = structuredCursor({ id: "507f1f77bcf86cd799439011", sort });

        expect(yield* Effect.result(listing.getJobsWithCursor({ cursor }))).toMatchObject({
          _tag: "Failure",
          failure: expect.any(InvalidCursorError),
        });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );

    it.effect.each(["not-an-id", 42, null])("rejects malformed structured identifier %j", (id) =>
      Effect.gen(function* () {
        const cursor = structuredCursor({
          id,
          sort: { by: "updatedAt", direction: "desc", value: "2026-02-01T12:00:00.000Z" },
        });

        expect(yield* Effect.result(listing.getJobsWithCursor({ cursor }))).toMatchObject({
          _tag: "Failure",
          failure: expect.any(InvalidCursorError),
        });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );

    it.effect("rejects a cursor used with a different sort", () =>
      Effect.gen(function* () {
        returnJobs([JobFactory.build()]);
        const cursor = yield* issueCursor({
          sort: { by: JobCursorSortField.UPDATED_AT, direction: JobCursorSortDirection.DESC },
        });
        vi.mocked(ctx.mockCollection.find).mockClear();

        expect(
          yield* Effect.result(
            listing.getJobsWithCursor({
              cursor,
              sort: { by: JobCursorSortField.CREATED_AT, direction: JobCursorSortDirection.DESC },
            }),
          ),
        ).toMatchObject({
          _tag: "Failure",
          failure: { message: expect.stringContaining("Cursor does not match requested sort") },
        });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );

    it.effect("rejects a legacy cursor used with a date sort", () =>
      Effect.gen(function* () {
        returnJobs([JobFactory.build()]);
        const cursor = yield* issueCursor();
        vi.mocked(ctx.mockCollection.find).mockClear();

        expect(
          yield* Effect.result(
            listing.getJobsWithCursor({
              cursor,
              sort: { by: JobCursorSortField.CREATED_AT, direction: JobCursorSortDirection.DESC },
            }),
          ),
        ).toMatchObject({ _tag: "Failure", failure: expect.any(InvalidCursorError) });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );
  });

  describe("page assembly", () => {
    it.effect("trims the extra Job before restoring backward display order", () =>
      Effect.gen(function* () {
        const jobs = JobFactory.buildList(4);
        returnJobs(jobs);

        const page = yield* listing.getJobsWithCursor({
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
      }),
    );

    it.effect("omits payloads from summary reads and shares full listing cursors", () =>
      Effect.gen(function* () {
        const job = JobFactory.build({ data: { private: "payload" } });
        returnJobs([job]);

        const full = yield* listing.getJobsWithCursor();
        const summary = yield* listing.getJobSummariesWithCursor();

        expect(summary.cursor).toBe(full.cursor);
        expect(summary.jobs[0]).not.toHaveProperty("data");
        expect(ctx.mockCollection.find).toHaveBeenLastCalledWith(
          {},
          { maxTimeMS: 30_000, projection: { data: 0 } },
        );
      }),
    );

    it.effect.each([0, -1, 1.5, 1001, Number.NaN])(
      "rejects invalid page size %s before reading",
      (limit) =>
        Effect.gen(function* () {
          expect(yield* Effect.result(listing.getJobsWithCursor({ limit }))).toMatchObject({
            _tag: "Failure",
            failure: expect.any(InvalidJobQueryError),
          });
          expect(yield* Effect.result(listing.getJobSummariesWithCursor({ limit }))).toMatchObject({
            _tag: "Failure",
            failure: expect.any(InvalidJobQueryError),
          });
          expect(ctx.mockCollection.find).not.toHaveBeenCalled();
        }),
    );
  });

  describe("getJobsWithCursor", () => {
    it.effect("should return page with jobs and cursor info", () =>
      Effect.gen(function* () {
        const jobs = JobFactory.buildList(2);

        returnJobs(jobs);

        const page = yield* listing.getJobsWithCursor({ limit: 10 });

        expect(page.jobs).toHaveLength(2);
        expect(page.hasNextPage).toBe(false);
        expect(page.hasPreviousPage).toBe(false);
      }),
    );

    it.effect("should throw InvalidCursorError for malformed cursor", () =>
      Effect.gen(function* () {
        expect(
          yield* Effect.result(listing.getJobsWithCursor({ cursor: "invalid-base64-cursor" })),
        ).toMatchObject({ _tag: "Failure", failure: expect.any(InvalidCursorError) });
      }),
    );

    it.effect("should detect hasNextPage when more results exist", () =>
      Effect.gen(function* () {
        // Return 11 jobs when limit is 10 (fetches limit + 1 to detect next page)
        const jobs = JobFactory.buildList(11);

        returnJobs(jobs);

        const page = yield* listing.getJobsWithCursor({ limit: 10 });

        expect(page.jobs).toHaveLength(10); // Should trim to limit
        expect(page.hasNextPage).toBe(true);
      }),
    );

    it.effect("should sort by whitelisted field with identifier tie-breaker", () =>
      Effect.gen(function* () {
        const jobs = JobFactory.buildList(2, {
          updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        });

        const mockCursor = returnJobs(jobs);

        yield* listing.getJobsWithCursor({
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
      }),
    );

    it.effect("should throw ConnectionError when database operation fails", () =>
      Effect.gen(function* () {
        returnJobs([]).toArray.mockRejectedValueOnce(new Error("Database error"));

        expect(yield* Effect.result(listing.getJobsWithCursor())).toMatchObject({
          _tag: "Failure",
          failure: expect.any(ConnectionError),
        });
      }),
    );

    it.effect("should wrap non-Error thrown values in ConnectionError", () =>
      Effect.gen(function* () {
        returnJobs([]).toArray.mockRejectedValueOnce("Network failure");

        expect(yield* Effect.result(listing.getJobsWithCursor())).toMatchObject({
          _tag: "Failure",
          failure: expect.any(ConnectionError),
        });
      }),
    );
  });
});

function structuredCursor(payload: unknown): string {
  return "F" + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
