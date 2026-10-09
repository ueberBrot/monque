import { it } from "@effect/vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { Effect } from "effect";
import type { FindCursor, Document, WithId } from "mongodb";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, vi } from "vite-plus/test";

import { CursorDirection, JobCursorSortDirection, JobCursorSortField } from "@/jobs";
import type { CursorOptions } from "@/jobs";
import { CursorListing } from "@/scheduler/services/cursor-listing.js";
import { ConnectionError, InvalidCursorError, InvalidJobQueryError } from "@/shared";
import { createMockContext, JobFactory } from "@tests/factories";
import { anyMatcher, stringContainingMatcher } from "@tests/setup/matchers.js";
import type { MockFunction } from "@tests/setup/mock-function.js";
import { nativeAsyncMock } from "@tests/setup/native-async-mock.js";

const structuredCursor = (payload: { id: string | number | null; sort?: unknown }): string =>
  `F${Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url")}`;
describe(CursorListing, () => {
  let ctx: ReturnType<typeof createMockContext>;
  const returnJobs = (jobs: WithId<Document>[]) => {
    const cursor = {
      sort: vi.fn<MockFunction<FindCursor["sort"]>>().mockReturnThis(),
      limit: vi.fn<MockFunction<FindCursor["limit"]>>().mockReturnThis(),
      toArray: nativeAsyncMock<FindCursor["toArray"]>(() => [...jobs]),
    };
    vi.spyOn(ctx.mockCollection, "find").mockReturnValue(
      fromAny<ReturnType<typeof ctx.mockCollection.find>, unknown>(cursor),
    );
    return cursor;
  };
  let listing: CursorListing;
  beforeEach(() => {
    ctx = createMockContext();
    listing = new CursorListing(ctx);
  });
  const issueCursor = Effect.fnUntraced(function* effectWorkflow1(options: CursorOptions = {}) {
    const page = yield* listing.getJobsWithCursor(options);
    if (page.cursor === null || page.cursor === "") {
      throw new Error("Expected cursor");
    }
    return page.cursor;
  });
  describe("cursor compatibility", () => {
    it.effect.each([
      [CursorDirection.FORWARD, "F"],
      [CursorDirection.BACKWARD, "B"],
    ] as const)("keeps the compact cursor format for %s listings", ([direction, prefix]) =>
      Effect.gen(function* effectWorkflow2() {
        const id = new ObjectId("507f1f77bcf86cd799439011");
        returnJobs([JobFactory.build({ _id: id })]);
        const page = yield* listing.getJobsWithCursor({ direction });
        expect(page.cursor).toBe(
          prefix + Buffer.from(id.toHexString(), "hex").toString("base64url"),
        );
        expect(page.cursor).not.toMatch(/[+/=]/u);
        expect((yield* listing.getJobsWithCursor({ direction })).cursor).toBe(page.cursor);
      }),
    );
    it.effect.each([CursorDirection.FORWARD, CursorDirection.BACKWARD])(
      "reads an issued legacy cursor while traversing %s",
      (direction) =>
        Effect.gen(function* effectWorkflow3() {
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
      Effect.gen(function* effectWorkflow4() {
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
      Effect.gen(function* effectWorkflow5() {
        returnJobs([]);
        const page = yield* listing.getJobsWithCursor({ cursor: "" });
        expect(page).toStrictEqual({
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
      `F${Buffer.from("{", "utf-8").toString("base64url")}`,
    ])("rejects malformed cursor %s before reading Jobs", (cursor) =>
      Effect.gen(function* effectWorkflow6() {
        expect(yield* Effect.result(listing.getJobsWithCursor({ cursor }))).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(InvalidCursorError),
        });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );
    it.effect("keeps structured cursor metadata and uses it for date ties", () =>
      Effect.gen(function* effectWorkflow7() {
        const id = new ObjectId("507f1f77bcf86cd799439011");
        const updatedAt = new Date("2026-02-01T12:00:00.000Z");
        const sort = {
          by: JobCursorSortField.UPDATED_AT,
          direction: JobCursorSortDirection.DESC,
        };
        returnJobs([JobFactory.build({ _id: id, updatedAt })]);
        const cursor = yield* issueCursor({ sort });
        expect(
          JSON.parse(Buffer.from(cursor.slice(1), "base64url").toString("utf-8")),
        ).toStrictEqual({
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
      Effect.gen(function* effectWorkflow8() {
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
      Effect.gen(function* effectWorkflow9() {
        const cursor = structuredCursor({ id: "507f1f77bcf86cd799439011", sort });
        expect(yield* Effect.result(listing.getJobsWithCursor({ cursor }))).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(InvalidCursorError),
        });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );
    it.effect.each(["not-an-id", 42, null])("rejects malformed structured identifier %j", (id) =>
      Effect.gen(function* effectWorkflow10() {
        const cursor = structuredCursor({
          id,
          sort: { by: "updatedAt", direction: "desc", value: "2026-02-01T12:00:00.000Z" },
        });
        expect(yield* Effect.result(listing.getJobsWithCursor({ cursor }))).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(InvalidCursorError),
        });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );
    it.effect("rejects a cursor used with a different sort", () =>
      Effect.gen(function* effectWorkflow11() {
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
          failure: { message: stringContainingMatcher("Cursor does not match requested sort") },
        });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );
    it.effect("rejects a legacy cursor used with a date sort", () =>
      Effect.gen(function* effectWorkflow12() {
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
        ).toMatchObject({ _tag: "Failure", failure: anyMatcher(InvalidCursorError) });
        expect(ctx.mockCollection.find).not.toHaveBeenCalled();
      }),
    );
  });
  describe("page assembly", () => {
    it.effect("trims the extra Job before restoring backward display order", () =>
      Effect.gen(function* effectWorkflow13() {
        const jobs = JobFactory.buildList(4);
        const thirdJob = jobs.at(2);
        if (thirdJob === undefined) {
          throw new Error("Expected at least three fixture jobs");
        }
        returnJobs(jobs);
        const page = yield* listing.getJobsWithCursor({
          limit: 3,
          direction: CursorDirection.BACKWARD,
        });
        expect({
          pageJobsMapJobJob_id: page.jobs.map((job) => job._id),
          pageHasPreviousPage: page.hasPreviousPage,
          pageHasNextPage: page.hasNextPage,
          pageCursor: page.cursor,
        }).toStrictEqual({
          pageJobsMapJobJob_id: jobs
            .slice(0, 3)
            .toReversed()
            .map((job) => job._id),
          pageHasPreviousPage: true,
          pageHasNextPage: false,
          pageCursor: `B${Buffer.from(thirdJob._id.toHexString(), "hex").toString("base64url")}`,
        });
      }),
    );
    it.effect("omits payloads from summary reads and shares full listing cursors", () =>
      Effect.gen(function* effectWorkflow14() {
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
        Effect.gen(function* effectWorkflow15() {
          expect(yield* Effect.result(listing.getJobsWithCursor({ limit }))).toMatchObject({
            _tag: "Failure",
            failure: anyMatcher(InvalidJobQueryError),
          });
          expect(yield* Effect.result(listing.getJobSummariesWithCursor({ limit }))).toMatchObject({
            _tag: "Failure",
            failure: anyMatcher(InvalidJobQueryError),
          });
          expect(ctx.mockCollection.find).not.toHaveBeenCalled();
        }),
    );
  });
  describe("getJobsWithCursor", () => {
    it.effect("should return page with jobs and cursor info", () =>
      Effect.gen(function* effectWorkflow16() {
        const jobs = JobFactory.buildList(2);
        returnJobs(jobs);
        const page = yield* listing.getJobsWithCursor({ limit: 10 });
        expect({
          pageJobsLength: page.jobs.length,
          pageHasNextPage: page.hasNextPage,
          pageHasPreviousPage: page.hasPreviousPage,
        }).toStrictEqual({
          pageJobsLength: 2,
          pageHasNextPage: false,
          pageHasPreviousPage: false,
        });
      }),
    );
    it.effect("should throw InvalidCursorError for malformed cursor", () =>
      Effect.gen(function* effectWorkflow17() {
        expect(
          yield* Effect.result(listing.getJobsWithCursor({ cursor: "invalid-base64-cursor" })),
        ).toMatchObject({ _tag: "Failure", failure: anyMatcher(InvalidCursorError) });
      }),
    );
    it.effect("should detect hasNextPage when more results exist", () =>
      Effect.gen(function* effectWorkflow18() {
        // Return 11 jobs when limit is 10 (fetches limit + 1 to detect next page)
        const jobs = JobFactory.buildList(11);
        returnJobs(jobs);
        const page = yield* listing.getJobsWithCursor({ limit: 10 });
        // Should trim to limit
        expect({
          pageJobsLength: page.jobs.length,
          pageHasNextPage: page.hasNextPage,
        }).toStrictEqual({
          pageJobsLength: 10,
          pageHasNextPage: true,
        });
      }),
    );
    it.effect("should sort by whitelisted field with identifier tie-breaker", () =>
      Effect.gen(function* effectWorkflow19() {
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
      Effect.gen(function* effectWorkflow20() {
        returnJobs([]).toArray.mockRejectedValueOnce(new Error("Database error"));
        expect(yield* Effect.result(listing.getJobsWithCursor())).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(ConnectionError),
        });
      }),
    );
    it.effect("should wrap non-Error thrown values in ConnectionError", () =>
      Effect.gen(function* effectWorkflow21() {
        returnJobs([]).toArray.mockRejectedValueOnce("Network failure");
        expect(yield* Effect.result(listing.getJobsWithCursor())).toMatchObject({
          _tag: "Failure",
          failure: anyMatcher(ConnectionError),
        });
      }),
    );
  });
});
