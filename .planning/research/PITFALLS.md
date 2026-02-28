# Domain Pitfalls

**Domain:** MongoDB job queue library hardening (Monque)
**Researched:** 2026-02-27
**Scope:** bulkWrite optimization, TTL caching, payload validation, class refactoring, schema-driven mapping, instance collision detection

## Critical Pitfalls

Mistakes that cause data loss, duplicate processing, or require rewrites.

### Pitfall 1: bulkWrite Losing Per-Job State Validation

**What goes wrong:** Replacing the current `cancelJobs`/`retryJobs` cursor-iterate-findOneAndUpdate pattern with a naive `updateMany` drops the per-job status guard. `updateMany({status: 'pending'}, {$set: {status: 'cancelled'}})` will update jobs whose status changed between the initial `find()` and the `updateMany()` call. A job that transitioned from `pending` to `processing` in that window gets silently cancelled mid-execution.

**Why it happens:** The current O(n) pattern exists *because* each job needs an individual atomic state check via `findOneAndUpdate`. Developers optimizing for performance assume `updateMany` with a status filter is equivalent, but `updateMany` does not return which documents matched vs which were already in a different state. You lose the ability to report per-job errors in `BulkOperationResult.errors`.

**Consequences:**
- Processing jobs cancelled out from under active workers
- Silent data inconsistency (job shows `cancelled` but worker completed it)
- `BulkOperationResult.errors` array becomes empty/wrong (can't report "job status changed during cancellation")

**Prevention:**
- Use a two-phase approach: (1) `updateMany` with strict state filter `{status: 'pending'}` for the happy path, (2) re-query to identify jobs that *weren't* updated and report them as errors
- Compare `updateMany.modifiedCount` against the original `find().count()` to detect discrepancies
- Alternatively, use `bulkWrite` with individual `updateOne` operations per job ID, each including the state guard in its filter. This preserves per-job atomicity while batching the network call
- **Never** use unguarded `updateMany` without the source-state in the filter

**Detection:** Integration test where a job transitions from `pending` to `processing` between the filter query and the bulk update. If the test passes with the job still processing, the guard is working.

**Confidence:** HIGH (MongoDB docs confirm `updateMany` is not atomic across documents; current codebase already handles this correctly per-job)

**Addresses concern:** "Bulk operation optimization for cancelJobs/retryJobs"

---

### Pitfall 2: bulkWrite Partial Failure Swallowing Errors

**What goes wrong:** When using `bulkWrite({ordered: false})`, the MongoDB driver throws a `MongoBulkWriteError` if *any* operation fails. If you catch this as a generic error and rethrow, you lose the `error.result` (partial success info) and `error.writeErrors` (per-operation failures). The caller gets a generic "bulk write failed" error with no way to know which jobs succeeded.

**Why it happens:** `MongoBulkWriteError` has a non-obvious structure. The successful operations are accessible on `error.result` (not on a success response), and `error.writeErrors` is an array indexed by operation position, not by job ID. Developers unfamiliar with this API wrap bulkWrite in try/catch and throw a `ConnectionError`, losing all partial results.

**Consequences:**
- Callers can't distinguish "all failed" from "3 of 100 failed"
- Retry logic retries *all* operations including already-succeeded ones
- Event emission (`jobs:cancelled`, `jobs:retried`) fires with wrong counts or not at all

**Prevention:**
- Catch `MongoBulkWriteError` specifically (import from `mongodb` package)
- Extract `error.result.insertedCount`, `error.result.modifiedCount` for partial success
- Map `error.writeErrors[i].index` back to the original operation array to identify which job IDs failed
- Return partial results in `BulkOperationResult` rather than throwing
- Test with `ordered: false` explicitly, inserting a job that will fail the state guard

**Detection:** Unit test that mocks `bulkWrite` to throw `MongoBulkWriteError` with partial results. Assert that `BulkOperationResult` contains both the successful count and the per-job errors.

**Confidence:** HIGH (MongoDB official docs; `MongoBulkWriteError` API verified via search)

**Addresses concern:** "Bulk operation optimization for cancelJobs/retryJobs"

---

### Pitfall 3: Instance Collision Check False Positives After Crash

**What goes wrong:** A startup check that queries for processing jobs with the same `schedulerInstanceId` and throws an error will false-positive after a crash. If instance A crashes without graceful shutdown, its jobs remain `processing` with `claimedBy: 'instance-a-id'`. When instance A restarts with the same ID (e.g., in a container orchestrator that reuses UUIDs, or if the user hardcodes the ID), the collision check sees "stale" jobs from its own previous incarnation and refuses to start.

**Why it happens:** The collision check can't distinguish between "another live instance using my ID" and "my own previous incarnation left stale jobs". Both look identical in the database: `{status: 'processing', claimedBy: thisInstanceId}`.

**Consequences:**
- Instance refuses to start after crash recovery, requiring manual database cleanup
- In container environments (Kubernetes), this can create a restart loop where the replacement pod can never start
- Defeats the purpose of `recoverStaleJobs` which already handles this scenario

**Prevention:**
- **Use heartbeat staleness as the discriminator.** Query for `{claimedBy: thisInstanceId, status: 'processing', lastHeartbeat: {$gt: recentThreshold}}`. If `lastHeartbeat` is stale (older than `2 * heartbeatInterval`), these are leftover from a crashed instance, not a live collision. Only warn/throw if heartbeats are *recent*.
- Make the check a warning (log + event emission), not a hard error. The user can decide what to do.
- Document that hardcoding `schedulerInstanceId` is an advanced option with collision risks.
- Run the collision check *after* `recoverStaleJobs` so stale jobs are already cleaned up.

**Detection:** Integration test: start instance, kill it without shutdown, restart with same ID. Assert it starts successfully and recovers stale jobs rather than throwing.

**Confidence:** HIGH (this is a well-known pattern in distributed systems; the existing `recoverStaleJobs` mechanism already implies crash recovery is expected)

**Addresses concern:** "schedulerInstanceId collision startup check"

---

### Pitfall 4: TTL Cache Serving Stale Stats During Rapid State Changes

**What goes wrong:** A TTL-based cache for `getQueueStats` returns stale data when jobs transition rapidly (e.g., batch enqueue of 1000 jobs followed by immediate stats check). The caller sees `{pending: 0}` because the cache hasn't expired, but there are actually 1000 pending jobs. Worse: if the cache TTL is long and the stats are used for auto-scaling decisions, the system under-scales.

**Why it happens:** Stats caching is inherently at odds with real-time accuracy. A naive implementation caches the aggregation result with a fixed TTL and returns it until expiry, with no way for callers to bypass the cache when they need fresh data.

**Consequences:**
- UI dashboards show stale numbers
- Auto-scaling decisions based on stale stats cause under/over-provisioning
- Confusing debugging: "I enqueued 100 jobs but stats says 0"

**Prevention:**
- Make caching **opt-in** with a configurable TTL (default: disabled or very short like 1-5 seconds)
- Provide a `forceRefresh` option on `getQueueStats` to bypass cache
- Cache key must include the filter (e.g., `name` parameter) — otherwise filtered and unfiltered stats share a stale entry
- Invalidate cache on write operations that change job counts (enqueue, cancel, complete) if the invalidation cost is low
- Document that cached stats are approximate and not suitable for real-time decisions

**Detection:** Unit test: call `getQueueStats`, enqueue a job, immediately call `getQueueStats` again within TTL. Assert second call returns stale data. Call with `forceRefresh: true`, assert fresh data.

**Confidence:** HIGH (standard caching pitfall; applies directly to this use case)

**Addresses concern:** "getQueueStats TTL-based caching"

## Moderate Pitfalls

### Pitfall 5: Payload Size Validation Measuring JSON Instead of BSON

**What goes wrong:** Implementing `maxPayloadSize` by checking `JSON.stringify(data).length` instead of `BSON.calculateObjectSize(data)`. JSON and BSON have different size characteristics: BSON includes type information, field names as C-strings (null-terminated), and has different encoding for dates (8 bytes in BSON vs variable-length ISO string in JSON). A payload that's 14MB as JSON could be 17MB as BSON, or vice versa.

**Why it happens:** `JSON.stringify` is the "obvious" size check. Developers don't realize BSON overhead can make a document larger than its JSON representation, or that `BSON.calculateObjectSize` exists in the `mongodb` driver package.

**Consequences:**
- Payloads pass validation but fail at MongoDB insert time with `Document exceeds maximum size`
- False rejections: payloads that would fit in BSON are rejected because their JSON representation is large (rare but confusing)

**Prevention:**
- Use `BSON.calculateObjectSize` from the `bson` package (re-exported by `mongodb` driver) for accurate size checks
- Validate the `data` field only, not the full document — the job metadata (status, timestamps, etc.) adds ~500 bytes of BSON overhead
- Add a safety margin: reject at `maxPayloadSize - 1KB` to account for document metadata
- Fall back to `JSON.stringify(data).length` as a fast pre-check if BSON calculation is too slow, but always verify with BSON for borderline sizes
- Handle non-serializable values (functions, circular references, `undefined` values) gracefully — `BSON.calculateObjectSize` will throw, not return a wrong size

**Detection:** Unit test with payloads at the boundary: one that's just under the limit in JSON but over in BSON, and vice versa. Assert correct accept/reject behavior.

**Confidence:** MEDIUM (BSON size behavior verified via MongoDB docs; `calculateObjectSize` edge cases with BigInt noted but not relevant for typical job payloads)

**Addresses concern:** "Optional maxPayloadSize validation on job data"

---

### Pitfall 6: Payload Validation Breaking Existing Consumers

**What goes wrong:** Adding `maxPayloadSize` validation to `enqueue()` and `schedule()` as a required check (always-on) breaks existing consumers who are unknowingly sending large payloads. Their code worked fine before the upgrade, now it throws `MonqueError: Payload exceeds maximum size`.

**Why it happens:** The CONCERNS.md specifies "optional maxPayloadSize option" but the implementation might default to a "sensible" value like 1MB, surprising consumers with existing 2MB payloads.

**Consequences:**
- Breaking change in a minor/patch release (violates project constraints)
- Consumer trust erosion ("upgrading Monque broke our production pipeline")

**Prevention:**
- `maxPayloadSize` must default to `undefined` (no validation). Only validate when explicitly set.
- Validation must throw a specific, documented error type (e.g., `PayloadTooLargeError extends MonqueError`)
- Log a warning (not error) if payload exceeds 8MB even without `maxPayloadSize` set — MongoDB's 16MB limit is a hard wall
- Document the option clearly with examples showing the default behavior

**Detection:** Integration test: enqueue a 5MB payload with no `maxPayloadSize` set. Assert it succeeds. Set `maxPayloadSize: 1024`, enqueue same payload, assert specific error type.

**Confidence:** HIGH (this is a backward-compatibility concern, directly from project constraint "non-breaking")

**Addresses concern:** "Optional maxPayloadSize validation on job data"

---

### Pitfall 7: documentToPersistedJob Mapper Drift After Adding Fields

**What goes wrong:** A new field is added to the `Job` interface (e.g., `priority?: number`) and to the MongoDB insert logic, but `documentToPersistedJob` is not updated. The field exists in the database but is silently dropped when reading jobs back. Events emit jobs without the field. API consumers see inconsistent data.

**Why it happens:** The current manual mapping in `document-to-persisted-job.ts` requires explicit `if (doc['fieldName'] !== undefined)` for every optional field. There's no compile-time check that all `Job` fields are mapped. The existing round-trip test (PR #189) helps but only catches fields present in the factory.

**Consequences:**
- Silent data loss on read path
- Events emit incomplete job objects
- Consumers make decisions based on missing data (e.g., no `priority` field means default priority)

**Prevention:**
- **Schema-driven approach:** Define a `JOB_FIELD_DESCRIPTORS` array of `{field, required, type}` and generate the mapper from it. Adding a field means adding one entry to the descriptor array.
- **Compile-time guard:** Create a type-level check (e.g., `satisfies Record<keyof Job, unknown>`) that fails to compile if a Job field isn't in the descriptor
- **Exhaustive round-trip test:** The test should build a `JobDocument` with *every* optional field populated (not just factory defaults) and assert they all survive the round-trip
- Avoid over-engineering: the current 52-line mapper is simple and readable. A descriptor array adds indirection. Consider whether JSDoc comments + exhaustive test is sufficient.

**Detection:** Add a type-level check in `document-to-persisted-job.ts` that will cause a compile error if `Job` and the mapper diverge. Run `bun run type-check` as the verification step.

**Confidence:** HIGH (the concern is already documented in CONCERNS.md; the current test partially addresses this but could be more exhaustive)

**Addresses concern:** "documentToPersistedJob mapper robustness (schema-driven or generated)"

---

### Pitfall 8: Monque Class Extraction Breaking the SchedulerContext Contract

**What goes wrong:** Extracting a `LifecycleManager` from the Monque class requires it to access `SchedulerContext` properties (timers, intervals, `isRunning` state). If the extraction creates a new class that *also* holds lifecycle state (like `pollTimer`, `heartbeatTimer`), the Monque class and LifecycleManager can get out of sync. Calling `monque.stop()` clears Monque's state but not LifecycleManager's timers, or vice versa.

**Why it happens:** The Monque class currently owns all timer handles directly (lines ~1000-1040 in `monque.ts`). Extracting a service means deciding who owns the timer lifecycle. If ownership is split, the shutdown sequence becomes fragile.

**Consequences:**
- Timer leaks in tests (intervals keep firing after `stop()`)
- Flaky shutdown tests (existing `shutdown-race.test.ts` starts failing)
- Memory leaks in production (orphaned intervals)

**Prevention:**
- **Single owner principle:** The extracted service must fully own timer lifecycle — Monque delegates `start()`/`stop()` to it
- **The SchedulerContext interface must not change.** Services that consume `SchedulerContext` must be unaware of the refactoring. Only the Monque class ↔ new service boundary changes.
- Start with JSDoc deduplication (`@inheritdoc`/`@see`) rather than code extraction — this addresses the 900-line JSDoc bloat without touching logic
- If extracting a LifecycleManager: run the *entire* existing test suite (unit + integration + shutdown race) after each extraction step. No new tests needed if behavior is unchanged.
- Use the existing `stopMonqueInstances()` test utility to verify no timer leaks

**Detection:** After extraction, run `bun run test` — the existing shutdown race test and integration suite are the safety net. If any test becomes flaky or times out, the extraction broke timer ownership.

**Confidence:** HIGH (existing test coverage for shutdown is good per TESTING.md; the risk is in the extraction mechanics, not in unknown behavior)

**Addresses concern:** "Monque class size reduction"

---

### Pitfall 9: TTL Cache Memory Leak from Unbounded Cache Keys

**What goes wrong:** The `getQueueStats` cache stores entries keyed by filter parameters (e.g., `{name: 'send-email'}` vs `{name: 'process-order'}` vs no filter). If consumers call `getQueueStats` with many different `name` values, the cache grows without bound. Each entry holds a full `QueueStats` object plus the TTL timer.

**Why it happens:** TTL caches automatically evict *expired* entries, but if entries are refreshed before expiry (e.g., a dashboard polling every 2 seconds with a 5-second TTL), entries never expire and accumulate.

**Consequences:**
- Gradual memory growth proportional to unique filter combinations
- In long-running server processes, this eventually causes OOM
- Hard to diagnose: memory profiler shows many small `QueueStats` objects, not an obvious leak

**Prevention:**
- **Bound the cache size.** Maximum entries = number of registered workers + 1 (for unfiltered). This is a natural upper bound.
- Use a simple `Map<string, {data: QueueStats, expiresAt: number}>` with lazy eviction on `get()` rather than `setTimeout` per entry (avoids timer accumulation)
- Clear the entire cache on `stop()` to prevent leaks in test environments
- Do **not** use `WeakRef` or `FinalizationRegistry` — stats are plain objects (not referenceable), and GC timing is non-deterministic. A simple Map with TTL check is sufficient for this use case.
- Consider: a single cached value with a generation counter (invalidated on any write) may be simpler than a per-filter cache

**Detection:** Unit test: call `getQueueStats` with 100 different filter names. Assert cache size doesn't exceed the bound. Assert expired entries are cleaned up on next `get()`.

**Confidence:** HIGH (standard in-memory caching pattern; research confirms unbounded caches are the #1 memory leak source)

**Addresses concern:** "getQueueStats TTL-based caching"

## Minor Pitfalls

### Pitfall 10: bulkWrite Cursor Snapshot Inconsistency

**What goes wrong:** The current `cancelJobs` pattern does `collection.find(baseQuery)` then iterates the cursor. Between opening the cursor and processing each document, new jobs matching the query may be inserted, or existing jobs may change state. The cursor operates on a point-in-time snapshot (with MongoDB's default snapshot isolation), but the individual `findOneAndUpdate` calls operate on current state. This means the bulk operation may miss newly-inserted jobs or encounter already-changed jobs.

**Prevention:**
- This is *already handled correctly* by the per-job `findOneAndUpdate` state guard. The guard ensures only valid-state jobs are modified. Document this behavior: "bulk operations are eventually consistent — jobs added during the operation may not be included."
- Do not add snapshot isolation or transactions for bulk ops — the cost is not justified for a cancel/retry operation.

**Confidence:** HIGH

**Addresses concern:** "Bulk operation optimization for cancelJobs/retryJobs"

---

### Pitfall 11: BSON.calculateObjectSize Import Path

**What goes wrong:** The `BSON` module is available from both `import { BSON } from 'mongodb'` and `import { calculateObjectSize } from 'bson'`. Using the standalone `bson` package may produce size calculations that differ from what the `mongodb` driver internally uses if versions drift.

**Prevention:**
- Import `BSON` from the `mongodb` package directly (it re-exports the bundled BSON): `import { BSON } from 'mongodb'`
- Use `BSON.calculateObjectSize(data)` for consistent results with the driver's internal serialization
- The `mongodb` driver already depends on `bson` — no extra dependency needed

**Confidence:** MEDIUM (version drift risk is theoretical but documented in MongoDB community issues)

**Addresses concern:** "Optional maxPayloadSize validation on job data"

---

### Pitfall 12: Schema-Driven Mapper Over-Engineering

**What goes wrong:** Building a full schema descriptor system (`{field: 'name', required: true, type: 'string', bsonType: 'string'}`) for `documentToPersistedJob` adds a runtime abstraction layer over a simple 52-line function. The descriptor needs its own tests, its own types, and creates indirection that makes debugging harder.

**Prevention:**
- **Prefer compile-time safety over runtime abstraction.** A `satisfies` check or a type-level mapped type that enforces all `Job` keys are present in the mapper gives the same protection without runtime overhead.
- The existing round-trip test is the strongest defense. Make it exhaustive (every optional field populated) rather than building a descriptor system.
- If a descriptor is used, keep it minimal: `const JOB_FIELDS = ['name', 'data', 'status', ...] as const satisfies readonly (keyof Job)[]` — just the field list, not types or BSON mappings.

**Confidence:** MEDIUM (this is a judgment call; the current mapper works fine and is well-tested since PR #189)

**Addresses concern:** "documentToPersistedJob mapper robustness (schema-driven or generated)"

---

### Pitfall 13: Test Assertion Fragility After Bulk Optimization

**What goes wrong:** Existing unit tests for `cancelJobs`/`retryJobs` assert on `findOneAndUpdate` being called N times. After refactoring to use `updateMany` or `bulkWrite`, these assertions break even though the behavior is correct. This creates a false sense of "tests caught a regression" when actually the tests are just tightly coupled to the implementation.

**Prevention:**
- Existing unit tests that spy on specific collection methods (`vi.spyOn(ctx.mockCollection, 'findOneAndUpdate')`) will need updating. **Plan for this in the task scope.**
- Write integration tests that assert on *outcomes* (job statuses in the database) rather than *implementation* (which MongoDB method was called)
- Keep unit tests for the new bulk path (e.g., assert `bulkWrite` is called with correct operations) but also add integration tests
- Run `bun run test` after each step of the refactoring — the integration tests are the safety net

**Confidence:** HIGH (directly follows from TESTING.md patterns; the mock context pattern will need adaptation)

**Addresses concern:** "Bulk operation optimization for cancelJobs/retryJobs"

## Phase-Specific Warnings

| Phase/Concern | Likely Pitfall | Mitigation |
|---|---|---|
| Bulk operation optimization | Losing per-job state validation (#1), partial failure error swallowing (#2), test assertion fragility (#13) | Two-phase updateMany or bulkWrite with per-job filters; catch `MongoBulkWriteError` specifically; update unit test mocks |
| getQueueStats TTL caching | Stale stats (#4), memory leak from unbounded keys (#9) | Opt-in with configurable TTL, `forceRefresh` option, bound cache size to worker count + 1 |
| maxPayloadSize validation | JSON vs BSON size mismatch (#5), breaking existing consumers (#6), import path (#11) | Use `BSON.calculateObjectSize` from `mongodb` package, default to `undefined` (off), specific error type |
| schedulerInstanceId collision | False positives after crash (#3) | Use heartbeat staleness as discriminator, run after `recoverStaleJobs`, warn don't throw |
| Monque class refactoring | Breaking SchedulerContext contract (#8) | Start with JSDoc deduplication, single owner for timer lifecycle, run full test suite per step |
| documentToPersistedJob mapper | Field drift (#7), over-engineering (#12) | Compile-time `satisfies` check + exhaustive round-trip test, avoid runtime descriptor system |
| Test gaps (registerJobs, aggregation timeout, concurrent cleanup) | No specific pitfalls — these are additive tests with no source changes | Use existing test patterns from TESTING.md; mock collection methods for unit tests |

## Sources

- MongoDB official docs: bulkWrite behavior, `MongoBulkWriteError` structure, document-level atomicity — HIGH confidence
- MongoDB official docs: 16MB BSON document size limit, `BSON.calculateObjectSize` — HIGH confidence
- MongoDB community: `calculateObjectSize` edge cases with BigInt — MEDIUM confidence
- General distributed systems patterns: crash recovery false positives, TTL caching pitfalls — HIGH confidence
- Codebase analysis: `job-manager.ts` (lines 265-406), `job-query.ts` (lines 290-410), `document-to-persisted-job.ts`, `monque.ts` constructor and lifecycle — HIGH confidence
- CONCERNS.md: all 9 remaining concerns — PRIMARY context
- TESTING.md: test patterns, mock context factory, integration test infrastructure — PRIMARY context
