# Codebase Concerns

**Analysis Date:** 2026-02-24
**Last Updated:** 2026-02-28

## Tech Debt

~~**Unsafe `as unknown as` casts in production source code:**~~
- ~~Issue: `job-manager.ts` uses `as unknown as WithId<Job>` to cast raw MongoDB documents (4 occurrences), bypassing type safety at runtime boundaries~~
- **Resolved (2026-02-24):** Replaced all 4 casts with bracket notation, consistent with the existing pattern in `retryJob`.

**Deprecated option aliases still in active code paths:**
- Issue: `defaultConcurrency` and `maxConcurrency` are deprecated but still resolved in the constructor with fallback logic
- Files: `packages/core/src/scheduler/types.ts` (lines 72, 162), `packages/core/src/scheduler/monque.ts` (lines 143, 147)
- Impact: Two code paths for the same option increases maintenance burden and confuses new contributors
- Fix approach: Remove deprecated options in the next major version. Meanwhile, emit a deprecation warning at construction time when these are used.

~~**Unsafe `error as Error` casts in fire-and-forget catch handlers:**~~
- ~~Issue: 7 occurrences cast `unknown` error directly to `Error` without validation in `.catch()` callbacks on poll/heartbeat/cleanup intervals~~
- ~~Files: `packages/core/src/scheduler/monque.ts`, `packages/core/src/scheduler/services/job-processor.ts`, `packages/core/src/scheduler/services/change-stream-handler.ts`~~
- **Resolved:** All 7 sites replaced with `toError()` utility from `packages/core/src/shared/utils/error.ts`, which implements `value instanceof Error ? value : new Error(String(value))`. Zero `error as Error` casts remain in production source.

**`Monque` class is ~1294 lines (mostly JSDoc):**
- Issue: While logic is delegated to services, the facade class duplicates all JSDoc from the service layer and contains lifecycle/timer management
- Files: `packages/core/src/scheduler/monque.ts`
- Impact: Documentation maintenance burden — every API change requires updating JSDoc in two places (service + facade). The class itself is ~400 lines of logic + ~900 lines of comments/examples.
- Fix approach: Consider using `@inheritdoc` or `@see` tags to reference service-level docs rather than duplicating. Alternatively, extract timer/interval management into a dedicated `LifecycleManager` service.
- Note: Tracked as REFR-01, planned for Phase 4 (Structural Refactoring).

~~**Direct job status mutation in `completeJob`:**~~
- ~~Issue: `job.status = JobStatus.COMPLETED` directly mutates the in-memory job object after the DB update~~
- ~~Files: `packages/core/src/scheduler/services/job-processor.ts`~~
- **Resolved:** Both recurring and one-time paths in `completeJob` now use `findOneAndUpdate` with `returnDocument: 'after'` and convert via `documentToPersistedJob`. No in-memory mutation — event payloads consistently reflect the post-DB-update document.

## Known Bugs

**No known bugs detected.**
- The codebase has comprehensive integration tests covering core scenarios (locking, retry, shutdown, atomic claims, change streams, heartbeats, stale recovery).

## Security Considerations

~~**No input validation on job `data` payloads:**~~
- ~~Risk: `enqueue()` and `schedule()` accept arbitrary `data: T` and store it directly in MongoDB without size limits or sanitization~~
- ~~Files: `packages/core/src/scheduler/services/job-scheduler.ts` (lines 69-123)~~
- ~~Current mitigation: TypeScript generics provide compile-time safety for known callers~~
- ~~Recommendations: Add optional `maxPayloadSize` option. Consider validating that `data` is JSON-serializable before insertion to prevent BSON serialization errors at write time.~~
- **Resolved (2026-02-28, Phase 2 Plan 01):** Optional `maxPayloadSize` option added. Uses `BSON.calculateObjectSize` from the existing mongodb dependency to validate payload size before insertion. Throws `PayloadTooLargeError` when exceeded.

**No authentication/authorization on job operations:**
- Risk: Any code with a reference to the `Monque` instance can enqueue, cancel, retry, or delete any job
- Files: `packages/core/src/scheduler/monque.ts` (all public methods)
- Current mitigation: This is expected for a library — authorization is the consumer's responsibility
- Recommendations: Document this clearly. Consider adding optional middleware/hook pattern for consumers who need authorization checks.

~~**`schedulerInstanceId` defaults to random UUID but is user-overridable:**~~
- ~~Risk: If two instances use the same `schedulerInstanceId`, they will conflict on job claims and heartbeat updates, potentially causing duplicate processing~~
- ~~Files: `packages/core/src/scheduler/monque.ts` (line 148), `packages/core/src/scheduler/types.ts` (line 92)~~
- ~~Current mitigation: Default is `randomUUID()` which is practically collision-free~~
- ~~Recommendations: Add a startup check that validates no other active instance is using the same ID (e.g., via a brief collection query for processing jobs with the same claimedBy).~~
- **Resolved (2026-02-28, Phase 2 Plan 02):** Startup check during `initialize()` detects active instances using the same `schedulerInstanceId` via heartbeat staleness. Throws `ConnectionError` to prevent duplicate processing.

## Performance Bottlenecks

~~**Sequential index creation during `initialize()`:**~~
- ~~Problem: 7 `createIndex()` calls are awaited sequentially; not checked if indexes already exist before creation.~~
- ~~Files: `packages/core/src/scheduler/monque.ts`~~
- **Resolved:** Replaced 7 sequential `createIndex()` calls with a single `collection.createIndexes()` (plural) call containing all 7 index specifications in one array. Single MongoDB command, no sequential awaits.

~~**Bulk operations use cursor iteration with individual updates:**~~
- ~~Problem: `cancelJobs()` and `retryJobs()` iterate a cursor and issue individual `findOneAndUpdate` calls per document~~
- ~~Files: `packages/core/src/scheduler/services/job-manager.ts` (lines 275-335, 355-418)~~
- ~~Cause: Each job needs an atomic state transition check, but valid-state jobs could be batched~~
- ~~Improvement path: For jobs already in the correct source state, use `updateMany` with the state filter as a first pass, then enumerate any that failed the state check individually. This would reduce DB round-trips from O(n) to O(1) for the common case.~~
- **Resolved (2026-02-28, Phase 3 Plan 01):** Both `cancelJobs()` and `retryJobs()` replaced with single `updateMany` calls. Cancel uses status guard `{ status: 'pending' }`; retry uses pipeline-style updateMany with `$rand` stagger across 30s window. O(1) round-trips regardless of job count. Commit `4ccd27d4`.

**`getQueueStats` aggregation pipeline runs uncached:**
- Problem: Every call executes a full aggregation pipeline scan
- Files: `packages/core/src/scheduler/services/job-query.ts` (lines 290-410)
- Cause: No caching or debouncing mechanism for stats
- Improvement path: Add optional TTL-based caching for stats (e.g., cache for 5 seconds). Stats rarely need to be real-time.
- **Resolved (2026-02-28, Phase 3 Plan 02):** TTL+LRU cache added to `getQueueStats()` with configurable `statsCacheTtlMs` (default 5s). Per-filter cache keying, MAX_CACHE_SIZE=100 with LRU eviction, cache cleared on `stop()`. Set TTL=0 to disable. Commit `cff288b5`.

## Fragile Areas

**Shutdown race condition window:**
- Files: `packages/core/src/scheduler/monque.ts` (lines 1071-1139)
- Why fragile: The `stop()` method sets `isRunning = false` then clears intervals, but in-flight poll callbacks from the last interval tick may still be executing. The 100ms polling check interval for active jobs creates a tight timing window.
- Safe modification: Always test shutdown scenarios with active long-running jobs. The existing `tests/unit/shutdown-race.test.ts` and `tests/integration/shutdown.test.ts` cover this — run them after any change to lifecycle management.
- Test coverage: Good — dedicated shutdown race test exists

**Change stream reconnection logic:**
- Files: `packages/core/src/scheduler/services/change-stream-handler.ts`
- Why fragile: The reconnection uses `setTimeout` with exponential backoff, and the `setup()` method is called recursively. If the scheduler stops during a reconnection window, the timer must be properly cleared.
- Safe modification: Always verify `isRunning()` before any reconnection action. The `close()` method properly clears all timers. Test with the change stream error scenarios in `tests/integration/change-streams.test.ts`.
- Test coverage: Good — integration tests cover fallback, reconnection, and error scenarios

~~**`documentToPersistedJob` manual field mapping:**~~
- ~~Files: `packages/core/src/scheduler/monque.ts` (lines 1246-1282)~~
- ~~Why fragile: Every new field added to the `Job` interface must also be added to this mapping function. If a field is missed, it silently drops data.~~
- **Resolved (2026-02-28, Phase 2 Plan 01):** Explicit `PersistedJob<T>` return type annotation ensures compile-time errors if new required fields are missing from the mapper. Round-trip tests added for optional field drift.

## Scaling Limits

**Poll-based job discovery:**
- Current capacity: One poll per `pollInterval` (default 1s) per instance
- Limit: With many job types and high throughput, the poll loop iterates all registered workers sequentially and makes one `findOneAndUpdate` per available slot
- Scaling path: Change streams mitigate this for reactive processing. For high throughput, reduce `pollInterval` or increase `workerConcurrency`. The `instanceConcurrency` option caps total load per instance.

**Single MongoDB collection for all job types:**
- Current capacity: Depends on MongoDB cluster size and index efficiency
- Limit: All job types share indexes and compete for write locks on the same collection. At very high volumes (100k+ active jobs), index maintenance and WiredTiger contention may degrade.
- Scaling path: The `collectionName` option allows separate instances per logical queue. Document this as a scaling strategy for high-volume deployments.

**No job priority system:**
- Current capacity: Jobs are processed in `nextRunAt` order only
- Limit: Critical jobs cannot preempt lower-priority work
- Scaling path: Add an optional `priority` field with compound index `{priority, nextRunAt}` for priority-aware polling

## Dependencies at Risk

**No high-risk dependencies detected.**
- `mongodb` (^7.1.0) — actively maintained, pinned via overrides
- `cron-parser` — stable, focused library
- `@tsed/di` (tsed package) — framework coupling is intentional and properly abstracted

## Missing Critical Features

**No dead-letter queue mechanism:**
- Problem: When a job permanently fails (exhausts retries), it stays as `failed` in the collection with no automated escalation
- Blocks: Automated alerting pipelines, failed job routing to alternate handlers

**No job progress tracking:**
- Problem: Long-running jobs have no way to report intermediate progress
- Blocks: Progress bars in UIs, estimated time remaining for jobs

**No job timeout enforcement during processing:**
- Problem: The `lockTimeout` only governs stale recovery. If a worker handler hangs indefinitely, the job stays `processing` until the lock times out (default 30 min)
- Blocks: Predictable job execution times, resource management for stuck handlers
- Note: This is intentionally separate from heartbeats (which are observability-only)

## Test Coverage Gaps

~~**No dedicated round-trip test for `documentToPersistedJob`:**~~
- ~~What's not tested: That every field on the `Job` interface survives the document→PersistedJob mapping~~
- **Resolved (2026-02-28, Phase 2 Plan 01):** Explicit `PersistedJob<T>` return type annotation added to `documentToPersistedJob`. Adding a new required field to the Job interface now produces a compile-time error if the mapper is not updated.

~~**No unit tests for `MonqueModule.registerJobs()` in tsed package:**~~
- ~~What's not tested: The registration orchestration logic in `MonqueModule`, specifically the job discovery loop, duplicate detection, and cron scheduling registration~~
- **Resolved (2026-02-28, Phase 1 Plan 01):** Unit tests added covering scope resolution failures, duplicate detection, partial registration errors, and malformed metadata.

~~**`getQueueStats` aggregation timeout path is only tested implicitly:**~~
- ~~What's not tested: The `AggregationTimeoutError` throw path in `getQueueStats`~~
- **Resolved (2026-02-28, Phase 1 Plan 01):** Dedicated unit test validates `AggregationTimeoutError` is thrown when MongoDB returns a time limit error.

~~**Cleanup/retention feature lacks concurrent instance testing:**~~
- ~~What's not tested: Multiple Monque instances running cleanup simultaneously on the same collection~~
- **Resolved (2026-02-28, Phase 1 Plan 02):** Integration test added verifying concurrent Monque instances running cleanup simultaneously on the same collection behave correctly.

---

*Concerns audit: 2026-02-24*
*Last updated: 2026-02-28 — Phase 1 (test coverage), Phase 2 (safety/robustness), Phase 3 (performance) concerns resolved*
