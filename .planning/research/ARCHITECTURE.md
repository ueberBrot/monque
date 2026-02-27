# Architecture Patterns: Monque Hardening

**Domain:** MongoDB job queue library — internal refactoring & hardening
**Researched:** 2026-02-27
**Confidence:** HIGH (codebase analysis + established patterns)

## Current Architecture (Baseline)

```
                      Consumer Application
                              │
                              ▼
                    ┌───────────────────┐
                    │  Monque (Facade)  │  1253 lines — EventEmitter
                    │  ~400 logic       │  Owns: timers, lifecycle,
                    │  ~850 JSDoc       │  cleanup, stale recovery,
                    │                   │  indexes, context building
                    └────────┬──────────┘
                             │  builds SchedulerContext
                             │  delegates to services
                ┌────────────┼────────────┐
                │            │            │
         ┌──────┴──┐  ┌─────┴────┐  ┌────┴──────┐
         │JobSched.│  │JobProc.  │  │JobQuery.  │
         │enqueue  │  │poll      │  │getJob(s)  │
         │now      │  │acquire   │  │cursor     │
         │schedule │  │complete  │  │stats      │
         └─────────┘  │fail      │  └───────────┘
                      │heartbeat │
                      └──────────┘
                ┌──────────┐  ┌────────────┐
                │JobManager│  │ChangeStream│
                │cancel    │  │Handler     │
                │retry     │  │setup       │
                │delete    │  │reconnect   │
                │bulk ops  │  │close       │
                └──────────┘  └────────────┘
```

**Problem:** The facade class conflates three concerns:
1. **Public API delegation** (thin passthrough — correct)
2. **Lifecycle/timer management** (start/stop/intervals — should extract)
3. **Boot-time operations** (indexes, stale recovery, cleanup — could extract)

## Recommended Architecture (Post-Hardening)

### Component Boundaries

| Component | Responsibility | Communicates With | Change Type |
|-----------|---------------|-------------------|-------------|
| `Monque` (facade) | Public API, event emitter, `ensureInitialized()` guard | All services via `SchedulerContext` | **Shrinks** — removes timer/lifecycle logic |
| `LifecycleManager` (NEW) | Timer orchestration: poll, heartbeat, cleanup intervals; start/stop state; shutdown drain | `JobProcessor.poll()`, `JobProcessor.updateHeartbeats()`, `Monque.cleanupJobs()`, `ChangeStreamHandler` | **New internal service** |
| `JobScheduler` | Enqueue, now, schedule | `SchedulerContext` | **Unchanged** |
| `JobProcessor` | Poll, acquire, process, complete, fail, heartbeat | `SchedulerContext` | **Unchanged** |
| `JobManager` | Cancel, retry, delete, bulk ops | `SchedulerContext` | **Unchanged** |
| `JobQueryService` | getJob(s), cursor pagination, stats | `SchedulerContext` | **Minor** — add TTL cache for `getQueueStats` |
| `ChangeStreamHandler` | Change stream lifecycle | `SchedulerContext`, poll trigger | **Unchanged** |
| `documentToPersistedJob` | MongoDB doc to typed object | None (pure function) | **Harden** — schema-driven mapping |
| `InstanceGuard` (NEW) | Collision detection at startup | `SchedulerContext.collection` | **New utility** |

### Data Flow (Post-Hardening)

The fundamental data flow **does not change**. Improvements are additive:

```
Consumer
  │
  ▼
Monque.initialize()
  ├── createIndexes()                    [unchanged]
  ├── recoverStaleJobs()                 [unchanged]
  ├── InstanceGuard.check(instanceId)    [NEW — runs once at init]
  ├── build SchedulerContext             [unchanged]
  └── create services (incl. LifecycleManager)

Monque.start()
  └── delegates to LifecycleManager.start()
      ├── changeStreamHandler.setup()
      ├── setInterval(poll, pollInterval)
      ├── setInterval(heartbeat, heartbeatInterval)
      └── setInterval(cleanup, retentionInterval)  [if configured]

Monque.stop()
  └── delegates to LifecycleManager.stop()
      ├── isRunning = false
      ├── changeStreamHandler.close()
      ├── clearInterval(poll, heartbeat, cleanup)
      └── drain active jobs (with shutdown timeout)

Monque.enqueue(name, data, opts)
  ├── ensureInitialized()
  ├── [NEW] validate payload size if maxPayloadSize configured
  └── scheduler.enqueue(name, data, opts)

Monque.getQueueStats()
  └── query.getQueueStats()
      └── [NEW] check TTL cache → hit: return cached / miss: run aggregation, cache result
```

**Caching does NOT change any write path.** TTL cache is read-only optimization on `getQueueStats()` only. No cache invalidation needed because stats are inherently approximate with a configurable staleness window.

---

## Pattern 1: Extract LifecycleManager

**What:** Move timer management (poll interval, heartbeat interval, cleanup interval), start/stop state, and shutdown drain logic from `Monque` into a new `LifecycleManager` internal service.

**Why:** The `Monque` class currently manages 3 `setInterval` IDs, the `isRunning` flag, and the shutdown drain (polling for active jobs to complete). This is ~150 lines of logic interleaved with the facade's delegation role. Extracting it:
- Reduces `Monque` to pure delegation + event emission
- Makes lifecycle logic independently testable
- Follows the existing service pattern (receives `SchedulerContext`)

**Boundary:** `LifecycleManager` owns all `setInterval`/`clearInterval` calls and the shutdown race logic. `Monque` retains `isRunning` as a read-only property for `isHealthy()` but delegates mutation to `LifecycleManager`.

**Interface:**

```typescript
/** @internal */
export class LifecycleManager {
	constructor(
		private readonly ctx: SchedulerContext,
		private readonly changeStreamHandler: ChangeStreamHandler,
		private readonly processor: JobProcessor,
		private readonly cleanupFn: () => Promise<void>,
	) {}

	start(): void;
	stop(): Promise<void>;

	get running(): boolean;
}
```

**Key design decisions:**
- `LifecycleManager` receives specific service references it needs, not the entire service set. This avoids circular dependency (facade → lifecycle → facade).
- `cleanupFn` is passed as a closure from `Monque` rather than giving `LifecycleManager` access to the full facade. This keeps the cleanup logic (which reads `this.options.jobRetention`) in `Monque` where it belongs.
- `isRunning` state moves to `LifecycleManager` but `Monque.isHealthy()` reads it via the manager.
- The `isRunning()` function in `SchedulerContext` should reference `LifecycleManager.running` instead of the facade's field.

**What stays in Monque:**
- `ensureInitialized()` guard
- `isHealthy()` (reads from lifecycle manager)
- `buildContext()` (needs facade references)
- `createIndexes()` (boot-time, runs once)
- `recoverStaleJobs()` (boot-time, runs once)
- `cleanupJobs()` (the logic; lifecycle manages the interval)
- `register()` (worker map manipulation)
- All delegation methods (`enqueue`, `cancel`, etc.)
- Event emitter overrides

**Estimated facade size reduction:** ~150 lines of logic, bringing it to ~250 lines of logic + JSDoc. If JSDoc is also trimmed (using `@see` tags for service-level docs), the file could reach ~400-500 total lines.

**Confidence:** HIGH — follows the exact same `SchedulerContext`-based service pattern already established. Low risk.

---

## Pattern 2: Schema-Driven Document Mapping

**What:** Harden `documentToPersistedJob()` so adding a field to the `Job` interface causes a compile-time error if the mapper is not updated.

**Why not Zod/runtime validation:** The codebase has zero runtime schema libraries and the project philosophy is "no ORM, no Mongoose, native driver only." Adding Zod would introduce a dependency for a single mapping function. Overkill.

**Recommended approach: Compile-time exhaustiveness via `satisfies`**

The mapper already lives in its own file (`jobs/document-to-persisted-job.ts`). The improvement is to make it type-safe against drift:

```typescript
import type { Document, WithId } from 'mongodb';
import type { Job, JobStatusType, PersistedJob } from './types.js';

/**
 * Required fields that must always be present in the mapped output.
 * If a field is added to Job but not here, TypeScript will error.
 */
type RequiredJobFields = Pick<Job, 'name' | 'data' | 'status' | 'nextRunAt' | 'failCount' | 'createdAt' | 'updatedAt'>;

/**
 * Optional fields that are conditionally set.
 * The union of Required + Optional must equal Omit<Job, '_id'>.
 */
type OptionalJobFields = Pick<Job, 'lockedAt' | 'claimedBy' | 'lastHeartbeat' | 'heartbeatInterval' | 'failReason' | 'repeatInterval' | 'uniqueKey'>;

// Compile-time check: Required + Optional must cover all Job fields (minus _id)
type _ExhaustiveCheck = Omit<Job, '_id'> extends RequiredJobFields & Partial<OptionalJobFields>
	? RequiredJobFields & Partial<OptionalJobFields> extends Omit<Job, '_id'>
		? true
		: never  // A field in Required/Optional is not in Job
	: never; // A field in Job is not in Required/Optional

// This line causes a compile error if _ExhaustiveCheck is `never`
const _: _ExhaustiveCheck = true;
```

**Alternative considered:** Generating the mapper from the `Job` type using mapped types. Rejected because the conditional logic (`if doc['field'] !== undefined`) can't be generated from types alone — each optional field needs explicit handling to avoid setting `undefined` values on the output object (which matters for MongoDB `$exists` queries).

**The compile-time guard approach is zero-runtime-cost.** If someone adds a field to `Job`, TypeScript will refuse to compile until they update the required/optional field lists, which forces them to update the mapper body.

**Confidence:** HIGH — this is a standard TypeScript exhaustiveness technique. No dependencies.

---

## Pattern 3: TTL Cache in JobQueryService

**What:** Add a simple TTL cache for `getQueueStats()` results within `JobQueryService`.

**Where it lives:** Inside `JobQueryService`, not as a separate caching layer. Rationale:
- Only one method benefits from caching (`getQueueStats`)
- The cache is a single `{ data, expiry }` tuple, not a general caching infrastructure
- Adding a `CacheService` or decorator pattern is over-engineering for one cached method
- The query service already owns the data retrieval — keeping the cache here follows the "repository owns its cache" pattern

**Implementation:**

```typescript
export class JobQueryService {
	private statsCache: { data: QueueStats; expiry: number; key: string } | null = null;

	async getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats> {
		const cacheKey = filter?.name ?? '__all__';
		const now = Date.now();

		if (this.statsCache && this.statsCache.key === cacheKey && this.statsCache.expiry > now) {
			return this.statsCache.data;
		}

		// ... existing aggregation pipeline ...
		const stats = /* result */;

		const cacheTtl = this.ctx.options.statsCacheTtl; // optional, e.g. 5000ms
		if (cacheTtl) {
			this.statsCache = { data: stats, key: cacheKey, expiry: now + cacheTtl };
		}

		return stats;
	}
}
```

**Why not a Map/LRU cache:** `getQueueStats` has at most a handful of filter variations (one per job name). A single cached entry with a cache key is sufficient. No need for eviction policies.

**Configuration:** Add optional `statsCacheTtl?: number` to `MonqueOptions`. If not set, no caching occurs (backward compatible). Default: undefined (opt-in).

**Data flow impact:** None for writes. Stats reads may return data up to `statsCacheTtl` ms stale. This is explicitly acceptable — stats are already approximate (the aggregation itself has a time window).

**Confidence:** HIGH — trivial implementation, additive option, zero risk to existing behavior.

---

## Pattern 4: Optional Payload Validation (maxPayloadSize)

**What:** Add optional `maxPayloadSize` to `MonqueOptions` that validates `data` size before insertion in `JobScheduler.enqueue()`/`schedule()`.

**Where validation lives:** In `JobScheduler`, NOT in the `Monque` facade.

**Rationale:** Validation is a concern of the scheduling operation, not the facade. The facade's job is delegation. Putting validation in the service keeps it testable and co-located with the insert logic.

**Implementation approach:**

```typescript
// In JobScheduler
private validatePayloadSize(data: unknown): void {
	const maxSize = this.ctx.options.maxPayloadSize;
	if (maxSize === undefined) return; // opt-in only

	// BSON.calculateObjectSize would be ideal but requires importing bson
	// JSON.stringify is a reasonable proxy (BSON is typically slightly larger)
	const serialized = JSON.stringify(data);
	if (serialized !== undefined && serialized.length > maxSize) {
		throw new MonqueError(
			`Job payload size (${serialized.length} bytes) exceeds maxPayloadSize (${maxSize} bytes)`
		);
	}
}

async enqueue<T>(name: string, data: T, options: EnqueueOptions = {}): Promise<PersistedJob<T>> {
	this.validatePayloadSize(data);
	// ... existing logic ...
}
```

**Why JSON.stringify over BSON.calculateObjectSize:**
- `bson` is a transitive dependency of `mongodb`, but importing it directly would create a coupling to an internal dep
- JSON size is a reasonable proxy for BSON size (BSON adds type tags but JSON has quoting overhead — roughly comparable)
- The validation is a safety net, not an exact BSON budget

**Backward compatibility:** `maxPayloadSize` is optional with default `undefined`. No existing behavior changes. New error type could be `MonqueError` directly (or a new `PayloadTooLargeError` subclass if desired).

**Error type decision:** Use base `MonqueError` for now. A dedicated subclass is warranted only if consumers need to catch this specific error type programmatically. Can be added later without breaking changes.

**Confidence:** HIGH — additive optional config, simple validation, no API surface change.

---

## Pattern 5: Instance Collision Detection (InstanceGuard)

**What:** At startup (during `initialize()`), check if another active instance is using the same `schedulerInstanceId`.

**When it runs:** After collection is available, before services are created. Runs once, not continuously.

**How it detects collisions:** Query for `processing` jobs claimed by this instance ID. If any exist AND `recoverStaleJobs` didn't just reset them, another live instance is using the same ID.

**Implementation approach:**

```typescript
// New file: packages/core/src/scheduler/instance-guard.ts
import type { Collection, Document } from 'mongodb';
import { JobStatus } from '@/jobs';
import { ConnectionError } from '@/shared';

/**
 * Check for schedulerInstanceId collision at startup.
 *
 * Detects if another active Monque instance is using the same ID by looking
 * for processing jobs claimed by this ID that have a recent heartbeat
 * (indicating a live instance, not stale leftovers).
 *
 * @internal
 */
export async function checkInstanceCollision(
	collection: Collection<Document>,
	instanceId: string,
	heartbeatInterval: number,
): Promise<void> {
	// A job is "actively held" if it was claimed by this instanceId AND
	// has a heartbeat more recent than 2x the heartbeat interval
	// (stale recovery would have cleared truly abandoned jobs)
	const recentThreshold = new Date(Date.now() - heartbeatInterval * 2);

	const activeJob = await collection.findOne({
		status: JobStatus.PROCESSING,
		claimedBy: instanceId,
		lastHeartbeat: { $gte: recentThreshold },
	});

	if (activeJob) {
		throw new ConnectionError(
			`Another Monque instance appears to be running with schedulerInstanceId "${instanceId}". ` +
			`Found active processing job "${activeJob['name']}" (id: ${activeJob._id.toString()}) ` +
			`with recent heartbeat. Use a unique schedulerInstanceId for each instance.`
		);
	}
}
```

**Why this approach over alternatives:**
- **Simple collection query** — no separate "instance registry" collection needed
- **Heartbeat-aware** — distinguishes stale leftovers from actively-processed jobs
- **Non-blocking for default usage** — only triggers when someone manually sets `schedulerInstanceId` to a duplicate (the default `randomUUID()` is collision-proof)
- **Runs after stale recovery** — so recovered stale jobs don't trigger false positives

**Execution order in `initialize()`:**

```
1. create collection reference
2. create indexes (if !skipIndexCreation)
3. recover stale jobs (if recoverStaleJobs)
4. CHECK INSTANCE COLLISION  ← new step, after stale recovery
5. build context
6. create services
```

**Why after stale recovery:** If stale recovery resets all abandoned processing jobs, the collision check won't find any — which is correct. Only truly active jobs (with recent heartbeats) will remain, indicating a real collision.

**Edge case — disabled stale recovery:** If `recoverStaleJobs: false`, old stale jobs from a crashed instance with the same ID could trigger a false positive. Mitigation: the heartbeat threshold (`2 × heartbeatInterval`) ensures only recently-heartbeated jobs trigger the check. A crashed instance's jobs won't have recent heartbeats.

**Confidence:** HIGH — simple query, clear semantics, no new collections or infrastructure needed.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Introducing a DI Container
**What:** Replacing manual `SchedulerContext` injection with a DI framework
**Why bad:** The existing pattern is explicit, zero-dependency, and well-understood. A DI container adds complexity, learning curve, and a runtime dependency for zero practical benefit in a 6-service architecture.
**Instead:** Continue with `SchedulerContext` constructor injection. Add `LifecycleManager` to the same pattern.

### Anti-Pattern 2: General-Purpose Cache Layer
**What:** Creating a `CacheService` or `CacheManager` that multiple services can use
**Why bad:** Only one method (`getQueueStats`) needs caching. Building infrastructure for one use case is over-engineering. If more caching needs arise later, extract then.
**Instead:** Private cache field in `JobQueryService`, gated by optional config.

### Anti-Pattern 3: Runtime Schema Validation Library for Document Mapping
**What:** Adding Zod, io-ts, or similar for `documentToPersistedJob`
**Why bad:** Adds a runtime dependency, increases bundle size, introduces a new pattern inconsistent with the rest of the codebase. The mapping function is a single file with 15 field assignments.
**Instead:** Compile-time exhaustiveness check using TypeScript's type system (zero runtime cost).

### Anti-Pattern 4: Separate Instance Registry Collection
**What:** Creating a `monque_instances` collection for instance tracking
**Why bad:** Adds operational complexity (new collection, new indexes, TTL cleanup). The collision problem is simpler than that — just check if someone else is actively holding jobs with the same ID.
**Instead:** Query the existing `monque_jobs` collection for recent processing jobs with matching `claimedBy`.

---

## Suggested Build Order

Based on dependency analysis between improvements:

```
Phase 1: Foundation (no dependencies)
  ├── 1a. documentToPersistedJob schema guard  [standalone, types-only change]
  ├── 1b. Instance collision check              [standalone, new file]
  └── 1c. maxPayloadSize validation             [standalone, additive option]

Phase 2: Caching (depends on nothing, but benefits from test infrastructure in Phase 1)
  └── 2a. TTL cache for getQueueStats           [self-contained in JobQueryService]

Phase 3: Structural (depends on understanding all services' final shape)
  └── 3a. Extract LifecycleManager              [touches Monque, start/stop, tests]
```

**Why this order:**
1. **Phase 1 items are independent** — they can be done in parallel or any order. Each is a single file change + tests. They don't affect each other.
2. **Phase 2 (caching) is independent** but logically groups with "query service improvements." Doing it after Phase 1 means the test infrastructure for additive options is already proven.
3. **Phase 3 (lifecycle extraction) must come last** because:
   - It's the highest-risk refactor (touches the most lines)
   - It benefits from all other improvements being complete (fewer merge conflicts)
   - It should be the final commit in the milestone so any issues are isolated
   - The shutdown drain logic has existing edge-case tests that need careful verification

**Dependencies between improvements:**

```
documentToPersistedJob guard ──→ (none)
Instance collision check     ──→ (none, uses existing collection + heartbeat fields)
maxPayloadSize validation    ──→ (none, new option + check in JobScheduler)
TTL cache for stats          ──→ (none, new option + cache in JobQueryService)
LifecycleManager extraction  ──→ (logically after all above, to avoid rebasing across structural change)
```

**No hard dependencies exist between improvements.** The ordering is strategic (risk management, merge simplicity) not technical.

---

## Scalability Considerations

| Concern | Impact of Changes | Notes |
|---------|-------------------|-------|
| Stats cache | Reduces DB load at scale — fewer aggregation pipeline executions | Tunable via `statsCacheTtl` |
| Payload validation | Negligible — `JSON.stringify` on each enqueue is O(payload size) | Only runs when `maxPayloadSize` configured |
| Instance collision check | One `findOne` query at startup — zero ongoing cost | Uses existing indexes (`claimedBy + status`) |
| LifecycleManager extraction | Zero runtime impact — same timers, same logic, different class | Pure refactor |
| Document mapper guard | Zero runtime impact — compile-time only | No performance change |

## Sources

- Codebase analysis: `packages/core/src/scheduler/monque.ts` (1253 lines), `services/` directory, `jobs/document-to-persisted-job.ts`
- Architecture doc: `.planning/codebase/ARCHITECTURE.md` (existing analysis from 2026-02-24)
- Concerns doc: `.planning/codebase/CONCERNS.md` (audit from 2026-02-24)
- TypeScript exhaustiveness patterns: standard `satisfies` and conditional type techniques (HIGH confidence — core language feature)
- TTL cache in service layer: repository/service-owned cache pattern (HIGH confidence — well-established architectural pattern)
- Instance collision in job queues: Agenda.js `lockedAt` + `findAndModify` pattern as reference for MongoDB-native approach (MEDIUM confidence — adapted from similar library's pattern)
- Facade lifecycle extraction: standard refactoring pattern for large facade classes (HIGH confidence — established software engineering practice)

---

*Architecture research: 2026-02-27*
