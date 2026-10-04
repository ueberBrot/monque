import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type Document, type Filter, ObjectId, type WithId } from "mongodb";

import {
  CursorDirection,
  type CursorDirectionType,
  type CursorOptions,
  type CursorPage,
  type JobCursorSort,
  JobCursorSortDirection,
  JobCursorSortField,
  type JobSummaryPage,
  type PersistedJob,
} from "@/jobs";
import { ConnectionError, InvalidCursorError } from "@/shared";

import { attempt, fromPromise } from "../effects.js";
import { buildSelectorQuery, resolveQueryLimit } from "../helpers.js";
import type { SchedulerContext } from "./types.js";

type DecodedCursor = {
  id: ObjectId;
  sort?: JobCursorSort & { value: Date };
};

const DEFAULT_CURSOR_SORT: JobCursorSort = {
  by: JobCursorSortField.IDENTIFIER,
  direction: JobCursorSortDirection.ASC,
};
const LEGACY_CURSOR_PAYLOAD_BYTES = 12;
const STRUCTURED_CURSOR_PAYLOAD_PREFIX = "{".charCodeAt(0);
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

type MongoSortDirection = 1 | -1;
type CursorAnchor = {
  id: ObjectId | null;
  sortValue: Date | null;
};

/**
 * Lists full Jobs and Job summaries through the same cursor interface.
 *
 * Keeps cursor formats, traversal, query planning, payload projection, and page
 * assembly local so callers only supply their listing options.
 *
 * @internal Not part of public API.
 */
export class CursorListing {
  constructor(
    private readonly ctx: Pick<SchedulerContext, "collection" | "documentToPersistedJob">,
  ) {}

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

  private queryJobsWithCursor = Effect.fnUntraced(function* <T>(
    this: CursorListing,
    options: CursorOptions,
    includePayload: boolean,
  ): Effect.fn.Return<CursorPage<T>, unknown> {
    const { limit, direction, sort, anchor, query, mongoSort } = yield* attempt(() => {
      const limit = resolveQueryLimit(options.limit, 50);
      const direction: CursorDirectionType = options.direction ?? CursorDirection.FORWARD;
      const sort = options.sort ?? DEFAULT_CURSOR_SORT;
      const anchor = decodeCursorAnchor(options.cursor, sort);

      const query = buildSelectorQuery(options.filter === undefined ? {} : options.filter);
      const traversalDirection = getTraversalDirection(sort, direction);
      const mongoSort =
        sort.by === JobCursorSortField.IDENTIFIER
          ? { _id: traversalDirection }
          : { [sort.by]: traversalDirection, _id: traversalDirection };
      applyCursorConstraint(query, sort, traversalDirection, anchor.id, anchor.sortValue);
      return { limit, direction, sort, anchor, query, mongoSort };
    });

    const docs: WithId<Document>[] = yield* fromPromise(() =>
      this.ctx.collection
        .find(query, { maxTimeMS: 30_000, ...(includePayload ? {} : { projection: { data: 0 } }) })
        .sort(mongoSort)
        .limit(limit + 1)
        .toArray(),
    ).pipe(
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

function getTraversalDirection(
  sort: JobCursorSort,
  direction: CursorDirectionType,
): MongoSortDirection {
  const isAscending = sort.direction === JobCursorSortDirection.ASC;
  const isForward = direction === CursorDirection.FORWARD;
  return isAscending === isForward ? 1 : -1;
}

function applyCursorConstraint(
  query: Filter<Document>,
  sort: JobCursorSort,
  traversalDirection: MongoSortDirection,
  anchorId: ObjectId | null,
  anchorSortValue: Date | null,
): void {
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
}

function createPageCursor<T>(
  jobs: PersistedJob<T>[],
  direction: CursorDirectionType,
  sort: JobCursorSort,
): string | null {
  const lastJob = direction === CursorDirection.BACKWARD ? jobs[0] : jobs[jobs.length - 1];

  if (!lastJob) {
    return null;
  }

  switch (sort.by) {
    case JobCursorSortField.IDENTIFIER:
      return encodeCursor(lastJob._id, direction, sort);
    case JobCursorSortField.CREATED_AT:
    case JobCursorSortField.UPDATED_AT:
    case JobCursorSortField.NEXT_RUN_AT:
      return encodeCursor(lastJob._id, direction, sort, lastJob[sort.by]);
  }
}

function decodeCursorAnchor(cursor: string | undefined, sort: JobCursorSort): CursorAnchor {
  if (!cursor) {
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
}

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
function encodeCursor(
  id: ObjectId,
  direction: CursorDirectionType,
  sort: JobCursorSort = DEFAULT_CURSOR_SORT,
  sortValue?: Date,
): string {
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
  const buffer = Buffer.from(JSON.stringify(payload), "utf8");

  return prefix + buffer.toString("base64url");
}

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
function decodeCursor(cursor: string): DecodedCursor {
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
      return decodeStructuredCursor(buffer.toString("utf8"));
    }

    throw new InvalidCursorError("Invalid length");
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      throw error;
    }
    throw new InvalidCursorError("Invalid cursor payload");
  }
}

function decodeStructuredCursor(jsonPayload: string): DecodedCursor {
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
}
