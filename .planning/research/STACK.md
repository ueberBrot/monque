# Technology Stack — Hardening Approaches

**Project:** Monque Hardening Milestone
**Researched:** 2026-02-27
**Constraint:** Zero new runtime dependencies. This is a published library (`@monque/core`) with only `cron-parser` as runtime dep + `mongodb` as peer dep.

## Approach Summary

All five hardening areas can be addressed with zero new dependencies. Use Node.js builtins, TypeScript's type system, and APIs already available through the `mongodb` peer dependency.

---

## 1. TTL-Based Caching for `getQueueStats`

**Recommendation:** Hand-rolled `Map`-based TTL cache (~30 lines). No library.
**Confidence:** HIGH (standard Node.js pattern, verified with native APIs)

### Why Not a Library

Libraries like `lru-cache`, `node-cache`, or `keyv` add a runtime dependency for what is a ~30-line utility. This is a library — every dependency is a burden on consumers. The caching need is singular: cache one aggregation result per filter key for N seconds.

### Implementation Pattern

Use `Map<string, { value: T; expiresAt: number }>` with lazy expiration on read. **Do NOT use `setTimeout`-based eviction** — `setTimeout` timers prevent clean process exit unless `.unref()`'d, and add unnecessary complexity for a single-entry cache.

```typescript
// packages/core/src/shared/ttl-cache.ts

/**
 * Minimal TTL cache using lazy expiration (check-on-read).
 * No timers, no dependencies, no event loop side effects.
 *
 * @internal
 */
export class TtlCache<T> {
	private cache = new Map<string, { value: T; expiresAt: number }>();

	constructor(private readonly ttlMs: number) {}

	get(key: string): T | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;
		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return undefined;
		}
		return entry.value;
	}

	set(key: string, value: T): void {
		this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
	}

	invalidate(key: string): void {
		this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}
}
```

### Integration Point

In `JobQueryService.getQueueStats()`:
- Cache key: serialized filter (e.g., `filter?.name ?? '__all__'`)
- Default TTL: 5000ms (configurable via `MonqueOptions.statsCacheTtlMs`)
- Invalidate on `stop()` to prevent stale data across restart cycles
- Cache lives on the `JobQueryService` instance (not shared, not global)

### What NOT to Do

| Anti-Pattern | Why |
|---|---|
| `setTimeout`-based eviction | Timers leak into event loop; `.unref()` needed; overkill for 1-2 entries |
| `WeakRef`-based cache | Non-deterministic GC; stats are small objects; adds complexity for no gain |
| External cache (Redis, etc.) | Library must remain self-contained with only MongoDB |
| Global/static cache | Multiple `Monque` instances would share stale state |

---

## 2. MongoDB Bulk Operations for `cancelJobs`/`retryJobs`

**Recommendation:** Two-phase approach — `updateMany` for the common case, then `find` + report for the error case. NOT `bulkWrite`.
**Confidence:** HIGH (verified with mongodb driver API, matches existing codebase patterns)

### Current Problem

`cancelJobs()` and `retryJobs()` iterate a cursor and issue individual `findOneAndUpdate` calls — O(n) round trips.

### Why `updateMany` Over `bulkWrite`

The concern doc specifically identified this pattern. The key insight: for `cancelJobs`, every matching pending job gets the *identical* update. For `retryJobs`, every matching failed/cancelled job gets the *identical* update. This is a uniform operation — `updateMany` is the correct choice.

`bulkWrite` is for when different documents need different updates (different values per doc). Here, every cancel sets `{ status: 'cancelled', updatedAt: now }` identically. `updateMany` is a single DB command, single round trip, and MongoDB executes it atomically per-document server-side.

| Approach | Round Trips | Complexity | Use Case |
|---|---|---|---|
| Current (cursor + findOneAndUpdate) | O(n) | Low | N/A (too slow) |
| `updateMany` | O(1) | Low | Uniform update — **use this** |
| `bulkWrite` | O(1) | Medium | Per-document different updates — not needed here |

### Implementation Pattern for `cancelJobs`

```typescript
async cancelJobs(filter: JobSelector): Promise<BulkOperationResult> {
	const baseQuery = buildSelectorQuery(filter);
	const errors: Array<{ jobId: string; error: string }> = [];

	// Phase 1: Find jobs that DON'T meet the precondition (not pending/cancelled)
	// to report as errors
	const invalidJobs = await this.ctx.collection
		.find({
			...baseQuery,
			status: { $nin: [JobStatus.PENDING, JobStatus.CANCELLED] },
		})
		.project({ _id: 1, status: 1 })
		.toArray();

	for (const doc of invalidJobs) {
		errors.push({
			jobId: doc._id.toString(),
			error: `Cannot cancel job in status '${doc['status']}'`,
		});
	}

	// Phase 2: Bulk update all valid jobs in one round trip
	const result = await this.ctx.collection.updateMany(
		{ ...baseQuery, status: JobStatus.PENDING },
		{ $set: { status: JobStatus.CANCELLED, updatedAt: new Date() } },
	);

	const cancelledCount = result.modifiedCount;

	// Count already-cancelled jobs for idempotent total
	const alreadyCancelled = await this.ctx.collection.countDocuments({
		...baseQuery,
		status: JobStatus.CANCELLED,
	});

	if (cancelledCount > 0) {
		// Note: We can't emit individual job IDs without fetching them.
		// Emit count-based event. If individual IDs needed, fetch them
		// before the updateMany with a projection query.
		this.ctx.emit('jobs:cancelled', {
			jobIds: [], // or fetch IDs before update if needed
			count: cancelledCount,
		});
	}

	return {
		count: cancelledCount + alreadyCancelled,
		errors,
	};
}
```

### Trade-Off: Event Emission

The current per-job approach collects cancelled job IDs for the event. `updateMany` doesn't return matched IDs. Options:

1. **Fetch IDs before update** (recommended): One additional `find().project({_id:1}).toArray()` query — still O(2) round trips instead of O(n)
2. **Skip individual IDs in bulk event**: Emit count only. The `jobs:cancelled` event already has `count`.
3. **Use `bulkWrite` with `updateOne` ops**: Gets `modifiedCount` per op but adds complexity

Recommend option 1 — fetch IDs before the `updateMany`. Two queries is still O(2), dramatically better than O(n).

### `retryJobs` — Same Pattern

Identical structure. `updateMany` with filter `{ status: { $in: ['failed', 'cancelled'] } }` and the `$set/$unset` update document.

### What NOT to Do

| Anti-Pattern | Why |
|---|---|
| `bulkWrite` with `updateOne` per job | Same round trips as `updateMany` but more complex API; only needed for heterogeneous updates |
| Removing atomic preconditions | The `status: PENDING` filter in `updateMany` IS the atomic precondition — don't remove it |
| Returning fake IDs | Don't fabricate job IDs in the event payload |

---

## 3. Payload Size Validation (`maxPayloadSize`)

**Recommendation:** Use `BSON.calculateObjectSize()` from `mongodb` driver (already a peer dep). No new dependency.
**Confidence:** HIGH (verified: `mongodb` re-exports `BSON.calculateObjectSize` as a function, tested working)

### Key Discovery

The `mongodb` driver (peer dependency) re-exports the full `bson` package via `mongodb.BSON`. This means `calculateObjectSize` is already available:

```typescript
import { BSON } from 'mongodb';
const size = BSON.calculateObjectSize(jobData); // returns bytes
```

This was verified against `mongodb` ^7.1.0 — `BSON.calculateObjectSize` is a function returning the exact BSON byte count.

### Why BSON Size Over JSON Size

| Approach | Accuracy | Performance | Dependency |
|---|---|---|---|
| `BSON.calculateObjectSize(data)` | Exact — measures what MongoDB will actually store | Good — native BSON math | Already available via `mongodb` peer dep |
| `Buffer.byteLength(JSON.stringify(data))` | Approximate — JSON != BSON (Dates, ObjectIds, Binary differ) | Very fast (V8 optimized) | None |
| `new TextEncoder().encode(JSON.stringify(data)).length` | Same as above | Slower than Buffer | None |

**Use BSON** because:
1. The limit that matters is MongoDB's 16MB BSON document limit
2. BSON sizes differ from JSON sizes (Date objects, Binary, etc.)
3. The `mongodb` driver already provides this — zero cost
4. Validates what will actually be stored, not an approximation

### Implementation Pattern

Validation in `JobScheduler.enqueue()` and `JobScheduler.schedule()`:

```typescript
import { BSON } from 'mongodb';

// In enqueue/schedule, before insert:
if (this.ctx.options.maxPayloadSize !== undefined) {
	const payloadSize = BSON.calculateObjectSize({ data } as Document);
	if (payloadSize > this.ctx.options.maxPayloadSize) {
		throw new PayloadTooLargeError(payloadSize, this.ctx.options.maxPayloadSize);
	}
}
```

### New Error Type

Add `PayloadTooLargeError` to the error hierarchy:

```typescript
export class PayloadTooLargeError extends MonqueError {
	constructor(
		public readonly actualSize: number,
		public readonly maxSize: number,
	) {
		super(
			`Job payload size (${actualSize} bytes) exceeds maximum allowed size (${maxSize} bytes)`,
		);
	}
}
```

### Configuration

Add to `MonqueOptions`:

```typescript
/**
 * Maximum allowed BSON byte size for job data payloads.
 * Validated before insertion. Uses BSON.calculateObjectSize() for accuracy.
 * MongoDB's hard limit is 16MB (16,777,216 bytes) per document.
 *
 * @default undefined (no validation)
 */
maxPayloadSize?: number | undefined;
```

### What NOT to Do

| Anti-Pattern | Why |
|---|---|
| `JSON.stringify` size check | Inaccurate for BSON — Dates, Binary, ObjectId all differ |
| Adding `bson` as direct dep | Already available through `mongodb` peer dep |
| Validating full document size | Only validate `data` payload — the rest is controlled by the library |
| Making validation mandatory | Keep optional (default `undefined`); users who don't care shouldn't pay |
| Using Zod/Joi for size validation | Overkill for a byte count check; adds runtime dep |

---

## 4. Instance ID Collision Detection

**Recommendation:** MongoDB `findOne` check at startup in `initialize()`. Query for processing jobs with the same `claimedBy`.
**Confidence:** HIGH (uses existing MongoDB patterns in the codebase; no new deps)

### Why This Approach

The `schedulerInstanceId` defaults to `crypto.randomUUID()` which is practically collision-free. The risk is user-provided IDs (e.g., hardcoded, misconfigured). A simple startup check catches this before damage occurs.

### Implementation Pattern

In `Monque.initialize()`, after collection setup, before starting:

```typescript
private async checkInstanceIdCollision(): Promise<void> {
	// Check if any currently-processing jobs are claimed by our instance ID.
	// If so, either another live instance is using the same ID, or a previous
	// instance with the same ID crashed (stale jobs).
	const conflicting = await this.collection.findOne({
		status: JobStatus.PROCESSING,
		claimedBy: this.instanceId,
		// Exclude stale jobs (those would be recovered anyway)
		lockedAt: { $gt: new Date(Date.now() - this.options.lockTimeout) },
	});

	if (conflicting) {
		throw new ConnectionError(
			`Another active scheduler instance is using instanceId "${this.instanceId}". ` +
			'Each instance must have a unique schedulerInstanceId. ' +
			'If the previous instance crashed, wait for lockTimeout to expire or use a different ID.',
		);
	}
}
```

### Why Not a Dedicated Collection/Lock

| Approach | Pros | Cons |
|---|---|---|
| `findOne` on existing jobs collection | Zero schema changes; uses existing indexes; simple | Window between check and claim (acceptable) |
| Dedicated `monque_instances` collection | True lock; heartbeat-based liveness | New collection; cleanup burden; schema migration |
| MongoDB distributed lock | Guaranteed exclusive | Complex; requires TTL indexes; overkill |

The `findOne` approach is sufficient because:
1. The default `randomUUID()` makes accidental collision impossible
2. The check catches misconfiguration (user-provided duplicate IDs)
3. The existing `{ claimedBy, status }` index (index #4) makes this O(1)
4. False positives from stale jobs are filtered by `lockedAt` recency check

### What NOT to Do

| Anti-Pattern | Why |
|---|---|
| Unique index on instanceId | Instance IDs aren't stored in the jobs collection as a field; they're in `claimedBy` which is shared across job documents |
| Requiring external coordination | Library must work with just MongoDB; no Redis/ZooKeeper |
| Blocking startup for extended time | One `findOne` query is fast; don't add polling/retry loops |
| Throwing on stale jobs | Stale jobs from a crashed instance with the same ID are expected; only active conflicts matter |

---

## 5. `documentToPersistedJob` Mapper Robustness

**Recommendation:** Schema-driven field definition with a `JOB_FIELDS` constant + `keyof`-based iteration. Compile-time safety via `satisfies`.
**Confidence:** HIGH (pure TypeScript pattern; verified against current codebase)

### Current Problem

The mapper in `document-to-persisted-job.ts` manually maps each field with `doc['fieldName'] as Type`. Adding a new field to the `Job` interface requires updating the mapper — forgetting this silently drops data.

### Why Not Code Generation

| Approach | Pros | Cons |
|---|---|---|
| Manual mapping (current) | Simple, explicit | Fragile: silent field drops on interface changes |
| Schema-driven with `satisfies` | Compile-time catch for missing fields; explicit casting | Slightly more code; requires field metadata |
| Runtime schema (Zod/etc.) | Full validation | Adds runtime dep; overkill for internal mapping |
| Code generation (script) | Automatic | Build step complexity; harder to maintain; overkill |
| Generic `Object.entries()` loop | Zero maintenance | Loses type safety; can't handle optional fields differently |

### Implementation Pattern

Define a field specification that TypeScript can check against the `Job` interface at compile time:

```typescript
// packages/core/src/jobs/job-fields.ts

import type { Job } from './types.js';

/** Field classification for the document-to-job mapper. */
interface FieldSpec {
	/** Whether this field is required (must exist on every document) */
	required: boolean;
}

/**
 * Canonical field definitions for Job documents.
 * TypeScript enforces this covers ALL keys of Job<unknown>.
 *
 * Adding a field to the Job interface without adding it here
 * produces a compile-time error via `satisfies`.
 */
export const JOB_FIELDS = {
	_id: { required: true },
	name: { required: true },
	data: { required: true },
	status: { required: true },
	nextRunAt: { required: true },
	failCount: { required: true },
	createdAt: { required: true },
	updatedAt: { required: true },
	lockedAt: { required: false },
	claimedBy: { required: false },
	lastHeartbeat: { required: false },
	heartbeatInterval: { required: false },
	failReason: { required: false },
	repeatInterval: { required: false },
	uniqueKey: { required: false },
} as const satisfies Record<keyof Job<unknown>, FieldSpec>;

/** All optional field names on Job */
export type OptionalJobField = {
	[K in keyof typeof JOB_FIELDS]: (typeof JOB_FIELDS)[K]['required'] extends false ? K : never;
}[keyof typeof JOB_FIELDS];

/** All required field names on Job */
export type RequiredJobField = {
	[K in keyof typeof JOB_FIELDS]: (typeof JOB_FIELDS)[K]['required'] extends true ? K : never;
}[keyof typeof JOB_FIELDS];
```

The `satisfies Record<keyof Job<unknown>, FieldSpec>` is the key: if someone adds a field to the `Job` interface but forgets to add it to `JOB_FIELDS`, TypeScript reports a compile error.

### Updated Mapper

```typescript
import type { Document, WithId } from 'mongodb';
import type { PersistedJob } from './types.js';
import { JOB_FIELDS, type OptionalJobField } from './job-fields.js';

const OPTIONAL_FIELDS = (Object.keys(JOB_FIELDS) as Array<keyof typeof JOB_FIELDS>)
	.filter((key) => !JOB_FIELDS[key].required);

export function documentToPersistedJob<T>(doc: WithId<Document>): PersistedJob<T> {
	// Required fields — cast directly (trust MongoDB document structure)
	const job: PersistedJob<T> = {
		_id: doc._id,
		name: doc['name'] as string,
		data: doc['data'] as T,
		status: doc['status'] as JobStatusType,
		nextRunAt: doc['nextRunAt'] as Date,
		failCount: doc['failCount'] as number,
		createdAt: doc['createdAt'] as Date,
		updatedAt: doc['updatedAt'] as Date,
	};

	// Optional fields — only set if present in document
	for (const field of OPTIONAL_FIELDS) {
		if (doc[field] !== undefined) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(job as any)[field] = doc[field];
		}
	}

	return job;
}
```

### Alternative: Keep Explicit Mapping + Add Compile-Time Guard

If the loop approach feels too dynamic, keep the existing explicit mapping but add a compile-time type guard:

```typescript
// At the bottom of document-to-persisted-job.ts:
// Compile-time assertion: every Job field is handled.
// If a field is added to Job but not mapped above, this line errors.
type _AssertAllFieldsMapped = keyof Job<unknown> extends keyof typeof JOB_FIELDS
	? true
	: never;
// Usage: const _check: _AssertAllFieldsMapped = true;
```

This is simpler but doesn't guide developers to the right file. The `satisfies` approach is more self-documenting.

### What NOT to Do

| Anti-Pattern | Why |
|---|---|
| `as PersistedJob<T>` cast on raw document | Bypasses all type safety; fields could be missing |
| Runtime validation with Zod | Adds runtime dep; validates on every read (perf overhead on hot path) |
| Code generation from interface | Build step fragility; TypeScript interfaces don't exist at runtime |
| Spread operator `{ ...doc }` | Copies MongoDB internal fields (`__v`, etc.); no type narrowing |

---

## Alternatives Considered (Cross-Cutting)

| Category | Recommended | Alternative | Why Not |
|---|---|---|---|
| TTL Cache | Hand-rolled `Map` + lazy expiry | `lru-cache`, `node-cache` | Runtime dependency for ~30 lines of code |
| Bulk Operations | `updateMany` | `bulkWrite` with `updateOne` ops | Uniform updates don't need per-doc operations |
| Payload Size | `BSON.calculateObjectSize` via `mongodb` | `JSON.stringify` + `Buffer.byteLength` | JSON size != BSON size; inaccurate for Dates/Binary/ObjectId |
| Instance ID Check | `findOne` on existing collection | Dedicated lock collection | Schema migration burden; overkill for catching misconfiguration |
| Mapper Safety | `satisfies` + field spec const | Zod runtime schema, code generation | Zero runtime cost; compile-time only; no new deps |

---

## Installation

```bash
# No new dependencies required.
# All approaches use:
# - Node.js builtins (Map, Date.now(), crypto.randomUUID())
# - mongodb peer dependency (BSON.calculateObjectSize, Collection.updateMany, Collection.findOne)
# - TypeScript type system (satisfies, keyof, mapped types)
```

---

## New Types/Exports Summary

| Addition | Location | Public? |
|---|---|---|
| `TtlCache<T>` | `packages/core/src/shared/ttl-cache.ts` | No (`@internal`) |
| `PayloadTooLargeError` | `packages/core/src/shared/errors.ts` | Yes (exported from barrel) |
| `maxPayloadSize` option | `packages/core/src/scheduler/types.ts` | Yes (in `MonqueOptions`) |
| `statsCacheTtlMs` option | `packages/core/src/scheduler/types.ts` | Yes (in `MonqueOptions`) |
| `JOB_FIELDS` const | `packages/core/src/jobs/job-fields.ts` | No (`@internal`) |
| `OptionalJobField` type | `packages/core/src/jobs/job-fields.ts` | No (`@internal`) |
| `RequiredJobField` type | `packages/core/src/jobs/job-fields.ts` | No (`@internal`) |

---

## Sources

| Source | Confidence | Used For |
|---|---|---|
| MongoDB Node.js driver — `BSON.calculateObjectSize` verified locally via `mongodb` ^7.1.0 | HIGH | Payload size validation (#3) |
| MongoDB docs — `Collection.updateMany()`, `Collection.bulkWrite()` | HIGH | Bulk operations (#2) |
| MongoDB docs — max BSON document size (16MB / 16,777,216 bytes) | HIGH | Payload size context |
| TypeScript 5.9 — `satisfies` operator | HIGH | Mapper robustness (#5) |
| Node.js — `Map`, `Date.now()`, `crypto.randomUUID()` | HIGH | TTL cache (#1), Instance ID (#4) |
| V8 blog — `JSON.stringify` optimizations | MEDIUM | JSON vs BSON size decision |
| Community patterns — TTL cache with lazy expiration | MEDIUM | TTL cache design (#1) |
| System design patterns — distributed instance ID collision | MEDIUM | Instance ID check design (#4) |

---

*Stack research: 2026-02-27*
