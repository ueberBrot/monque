import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ObjectId } from "mongodb";
import type { Document, Filter, FindOptions, WithId } from "mongodb";

import { CursorDirection, JobCursorSortDirection, JobCursorSortField } from "@/jobs";
import type {
  CursorDirectionType,
  CursorOptions,
  CursorPage,
  JobCursorSort,
  JobSummaryPage,
  PersistedJob,
} from "@/jobs";
import { ConnectionError, InvalidCursorError } from "@/shared";

import { attempt, fromPromise } from "../effects.js";
import { buildSelectorQuery, resolveQueryLimit } from "../helpers.js";
import type { SchedulerContext } from "./types.js";

type MongoSortDirection = 1 | -1;
const getTraversalDirection = (
  sort: JobCursorSort,
  direction: CursorDirectionType,
): MongoSortDirection => {
  const isAscending = sort.direction === JobCursorSortDirection.ASC;
  const isForward = direction === CursorDirection.FORWARD;
  return isAscending === isForward ? 1 : -1;
};
const applyCursorConstraint = (
  query: Filter<Document>,
  sort: JobCursorSort,
  traversalDirection: MongoSortDirection,
  anchorId: ObjectId | null,
  anchorSortValue: Date | null,
): void => {
  if (anchorId === null) {
    return;
  }
  const operator = traversalDirection === 1 ? "$gt" : "$lt";
  if (sort.by === JobCursorSortField.IDENTIFIER) {
    query._id = { [operator]: anchorId };
    return;
  }
  if (anchorSortValue === null) {
    throw new InvalidCursorError("Cursor does not match requested sort");
  }
  query.$or = [
    { [sort.by]: { [operator]: anchorSortValue } },
    { [sort.by]: anchorSortValue, _id: { [operator]: anchorId } },
  ];
};
const DEFAULT_CURSOR_SORT: JobCursorSort = {
  by: JobCursorSortField.IDENTIFIER,
  direction: JobCursorSortDirection.ASC,
};
/**
 * Encode cursor anchor metadata into an opaque cursor string.
 *
 * Structured cursors use `prefix` + `base64url(JSON)` where `prefix` is `F`
 * for forward cursors or `B` for backward cursors. The JSON payload contains
 * the anchor job `id`, `sort.by`, `sort.direction`, and `sort.value` metadata.
 * Default identifier/ascending cursors without an explicit sort value keep the
 * compact legacy ObjectId payload for backwards compatibility.
 *
 * @param id - The job ID to use as the cursor anchor (exclusive)
 * @param direction - Cursor traversal direction
 * @param sort - Sort metadata for the cursor anchor; defaults to DEFAULT_CURSOR_SORT
 * @param sortValue - Optional Date sort field value for non-identifier cursor anchors
 * @returns Opaque base64url-encoded cursor string
 */
const encodeCursor = (
  id: ObjectId,
  direction: CursorDirectionType,
  sort: JobCursorSort = DEFAULT_CURSOR_SORT,
  sortValue?: Date,
): string => {
  const prefix = direction === CursorDirection.FORWARD ? "F" : "B";
  if (
    sort.by === JobCursorSortField.IDENTIFIER &&
    sort.direction === JobCursorSortDirection.ASC &&
    sortValue === undefined
  ) {
    const buffer = Buffer.from(id.toHexString(), "hex");
    return prefix + buffer.toString("base64url");
  }
  if (sort.by !== JobCursorSortField.IDENTIFIER && sortValue === undefined) {
    throw new InvalidCursorError("Cursor sort value is required");
  }
  const payload = {
    id: id.toHexString(),
    sort: {
      by: sort.by,
      direction: sort.direction,
      value: (sortValue ?? new Date(id.getTimestamp())).toISOString(),
    },
  };
  const buffer = Buffer.from(JSON.stringify(payload), "utf-8");
  return prefix + buffer.toString("base64url");
};
// oxlint-disable-next-line typescript/consistent-return -- All typed sort fields return; retain the legacy fallthrough for an invalid runtime option.
const createPageCursor = <T>(
  jobs: PersistedJob<T>[],
  direction: CursorDirectionType,
  sort: JobCursorSort,
): string | null => {
  const lastJob = direction === CursorDirection.BACKWARD ? jobs[0] : jobs.at(-1);
  if (!lastJob) {
    return null;
  }
  // oxlint-disable-next-line eslint/default-case -- The sort-field union is exhaustive; a new default throw would change legacy invalid-input behavior.
  switch (sort.by) {
    case JobCursorSortField.IDENTIFIER: {
      return encodeCursor(lastJob._id, direction, sort);
    }
    case JobCursorSortField.CREATED_AT:
    case JobCursorSortField.UPDATED_AT:
    case JobCursorSortField.NEXT_RUN_AT: {
      return encodeCursor(lastJob._id, direction, sort, lastJob[sort.by]);
    }
  }
};
interface CursorAnchor {
  id: ObjectId | null;
  sortValue: Date | null;
}
interface DecodedCursor {
  id: ObjectId;
  sort?: JobCursorSort & {
    value: Date;
  };
}
const LEGACY_CURSOR_PAYLOAD_BYTES = 12;
const STRUCTURED_CURSOR_PAYLOAD_PREFIX = "{".codePointAt(0);
const StructuredCursorPayload = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.String.check(Schema.makeFilter((id) => ObjectId.isValid(id))),
    sort: Schema.Struct({
      by: Schema.Literals(Object.values(JobCursorSortField)),
      direction: Schema.Literals(Object.values(JobCursorSortDirection)),
      value: Schema.DateFromString,
    }),
  }),
);
const decodeStructuredCursorPayload = Schema.decodeUnknownSync(StructuredCursorPayload);
const decodeStructuredCursor = (jsonPayload: string): DecodedCursor => {
  let payload: typeof StructuredCursorPayload.Type;
  try {
    payload = decodeStructuredCursorPayload(jsonPayload);
  } catch {
    throw new InvalidCursorError("Invalid cursor payload");
  }
  return {
    id: new ObjectId(payload.id),
    sort: payload.sort,
  };
};
/**
 * Decode an opaque cursor string into cursor anchor metadata.
 *
 * Accepts structured JSON cursors with `id`, `sort.by`, `sort.direction`, and
 * `sort.value` metadata, plus compact legacy ObjectId cursors.
 *
 * @param cursor - The opaque cursor string
 * @returns The decoded ID and optional sort metadata with Date sort value
 * @throws {InvalidCursorError} If the cursor format, ID, or sort metadata is invalid
 */
const decodeCursor = (cursor: string): DecodedCursor => {
  if (!cursor || cursor.length < 2) {
    throw new InvalidCursorError("Cursor is empty or too short");
  }
  const prefix = cursor.charAt(0);
  const payload = cursor.slice(1);
  if (prefix !== "F" && prefix !== "B") {
    throw new InvalidCursorError(`Invalid cursor prefix: ${prefix}`);
  }
  try {
    const buffer = Buffer.from(payload, "base64url");
    if (buffer.byteLength === LEGACY_CURSOR_PAYLOAD_BYTES) {
      return {
        id: new ObjectId(buffer.toString("hex")),
      };
    }
    if (buffer[0] === STRUCTURED_CURSOR_PAYLOAD_PREFIX) {
      return decodeStructuredCursor(buffer.toString("utf-8"));
    }
    throw new InvalidCursorError("Invalid length");
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw error;
    }
    throw new InvalidCursorError("Invalid cursor payload");
  }
};
const decodeCursorAnchor = (cursor: string | undefined, sort: JobCursorSort): CursorAnchor => {
  if (cursor === undefined || !cursor) {
    return { id: null, sortValue: null };
  }
  const decoded = decodeCursor(cursor);
  const cursorSort = decoded.sort ?? DEFAULT_CURSOR_SORT;
  if (cursorSort.by !== sort.by || cursorSort.direction !== sort.direction) {
    throw new InvalidCursorError("Cursor does not match requested sort");
  }
  return {
    id: decoded.id,
    sortValue: decoded.sort?.value ?? null,
  };
};
const prepareCursorQuery = (options: CursorOptions) => {
  const limit = resolveQueryLimit(options.limit, 50);
  const direction: CursorDirectionType = options.direction ?? CursorDirection.FORWARD;
  const sort = options.sort ?? DEFAULT_CURSOR_SORT;
  const anchor = decodeCursorAnchor(options.cursor, sort);
  const { filter = {} } = options;
  const query = buildSelectorQuery(filter);
  const traversalDirection = getTraversalDirection(sort, direction);
  const mongoSort =
    sort.by === JobCursorSortField.IDENTIFIER
      ? { _id: traversalDirection }
      : { [sort.by]: traversalDirection, _id: traversalDirection };
  applyCursorConstraint(query, sort, traversalDirection, anchor.id, anchor.sortValue);
  return { limit, direction, sort, anchor, query, mongoSort };
};

const cursorFindOptions = (includePayload: boolean): FindOptions => {
  const options: FindOptions = { maxTimeMS: 30_000 };
  if (!includePayload) {
    options.projection = { data: 0 };
  }
  return options;
};

/**
 * Lists full Jobs and Job summaries through the same cursor interface.
 *
 * Keeps cursor formats, traversal, query planning, payload projection, and page
 * assembly local so callers only supply their listing options.
 *
 * Not part of public API.
 * @internal
 */
export class CursorListing {
  private readonly ctx: Pick<SchedulerContext, "collection" | "documentToPersistedJob">;
  constructor(ctx: Pick<SchedulerContext, "collection" | "documentToPersistedJob">) {
    this.ctx = ctx;
  }
  getJobsWithCursor<T = unknown>(
    options: CursorOptions = {},
  ): Effect.Effect<CursorPage<T>, unknown> {
    return this.queryJobsWithCursor<T>(options, true);
  }
  /** List job metadata using the same cursor as full listings, without reading payloads. */
  getJobSummariesWithCursor(options: CursorOptions = {}): Effect.Effect<JobSummaryPage, unknown> {
    return this.queryJobsWithCursor(options, false).pipe(
      Effect.map((page) => ({
        ...page,
        jobs: page.jobs.map(({ data: _data, ...summary }) => summary),
      })),
    );
  }
  private readonly queryJobsWithCursor = Effect.fnUntraced(function* loadCursorPage<T>(
    this: CursorListing,
    options: CursorOptions,
    includePayload: boolean,
  ): Effect.fn.Return<CursorPage<T>, unknown> {
    const { limit, direction, sort, anchor, query, mongoSort } = yield* attempt(() =>
      prepareCursorQuery(options),
    );
    const docs: WithId<Document>[] = yield* fromPromise(async () => {
      const { collection } = this.ctx;
      const findJobs = collection.find.bind(collection);
      const cursor = findJobs(query, cursorFindOptions(includePayload));
      const sortCursor = cursor.sort.bind(cursor);
      return await sortCursor(mongoSort)
        .limit(limit + 1)
        .toArray();
    }).pipe(
      Effect.catchCause((cause) => {
        const error = Cause.squash(cause);
        const message =
          error instanceof Error ? error.message : "Unknown error during getJobsWithCursor";
        return Effect.fail(
          new ConnectionError(
            `Failed to query jobs with cursor: ${message}`,
            error instanceof Error ? { cause: error } : undefined,
          ),
        );
      }),
    );
    const hasMore = docs.length > limit;
    if (hasMore) {
      docs.pop();
    }
    if (direction === CursorDirection.BACKWARD) {
      docs.reverse();
    }
    const jobs = docs.map((doc) => this.ctx.documentToPersistedJob<T>(doc));
    return {
      jobs,
      cursor: createPageCursor(jobs, direction, sort),
      hasNextPage: direction === CursorDirection.FORWARD ? hasMore : anchor.id !== null,
      hasPreviousPage: direction === CursorDirection.FORWARD ? anchor.id !== null : hasMore,
    };
  });
}
