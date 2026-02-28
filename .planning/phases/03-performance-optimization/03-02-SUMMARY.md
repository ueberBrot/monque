---
phase: 03-performance-optimization
plan: 02
subsystem: database
tags: [mongodb, caching, ttl, lru, aggregation, performance]

# Dependency graph
requires:
  - phase: 01-test-coverage-foundation
    provides: unit test infrastructure and mock context factory
provides:
  - TTL+LRU cache for getQueueStats() aggregation pipeline
  - statsCacheTtlMs configuration option in MonqueOptions
  - clearStatsCache() internal method for clean shutdown
affects: [04-structural-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns: [TTL+LRU cache using Map insertion order, per-filter cache keying]

key-files:
  created: []
  modified:
    - packages/core/src/scheduler/services/job-query.ts
    - packages/core/src/scheduler/types.ts
    - packages/core/src/scheduler/monque.ts
    - packages/core/tests/factories/context.ts
    - packages/core/tests/unit/services/job-query.test.ts

key-decisions:
  - "MAX_CACHE_SIZE=100 — internal constant, generous for one entry per distinct job name filter"
  - "Cache keyed by filter.name ?? '' — empty string for unfiltered queries"
  - "LRU approximation via Map insertion order — re-queried entries re-inserted at end"
  - "No proactive cache invalidation after mutations — TTL-only per user decision"

patterns-established:
  - "TTL+LRU cache pattern: Map<string, {data, expiresAt}> with size cap and insertion-order eviction"

requirements-completed: [PERF-02]

# Metrics
duration: 7min
completed: 2026-02-28
---

# Phase 3 Plan 2: Stats Cache Summary

**TTL+LRU cache for getQueueStats() eliminates redundant MongoDB aggregation pipeline executions within configurable TTL window (default 5s)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-28T12:48:11Z
- **Completed:** 2026-02-28T12:54:49Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `statsCacheTtlMs` option to MonqueOptions with default 5000ms
- Implemented TTL+LRU cache in JobQueryService with MAX_CACHE_SIZE=100 and per-filter keying
- Cache cleared on stop() for clean restart state; TTL=0 disables caching entirely
- 7 new unit tests covering all cache behaviors (hit, miss, per-filter, TTL=0, LRU eviction, clearStatsCache)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add statsCacheTtlMs option and implement TTL+LRU cache** - `cff288b5` (feat)
2. **Task 2: Add unit tests for stats cache behavior** - `fbde0b02` (test)

**Pre-existing 03-01 fix (blocking):** `4ccd27d4` (feat) — committed uncommitted 03-01 bulk ops changes that were blocking type-check

## Files Created/Modified
- `packages/core/src/scheduler/types.ts` - Added `statsCacheTtlMs?: number` to MonqueOptions
- `packages/core/src/scheduler/monque.ts` - Resolve option default, clear cache on stop()
- `packages/core/src/scheduler/services/job-query.ts` - TTL+LRU cache in getQueueStats(), clearStatsCache()
- `packages/core/tests/factories/context.ts` - Added statsCacheTtlMs to DEFAULT_TEST_OPTIONS
- `packages/core/tests/unit/services/job-query.test.ts` - 7 new cache behavior tests

## Decisions Made
- MAX_CACHE_SIZE=100 as internal constant — generous for typical use (one entry per job name filter + unfiltered)
- Cache key is `filter?.name ?? ''` — empty string for unfiltered queries, job name for filtered
- LRU via Map insertion order — newly accessed entries re-inserted at end, oldest evicted first
- No proactive invalidation after enqueue/bulk ops — TTL-only invalidation per user design decision

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Committed pre-existing 03-01 changes blocking type-check**
- **Found during:** Task 1 commit attempt
- **Issue:** 03-01 bulk ops changes (events/types.ts, job-manager.ts) were uncommitted in working tree, causing type errors in integration test (removed `jobIds` from event types but integration test still referenced it)
- **Fix:** Fixed integration test type annotation and assertion, committed all 03-01 changes as separate commit
- **Files modified:** packages/core/src/events/types.ts, packages/core/src/scheduler/services/job-manager.ts, packages/core/tests/unit/services/job-manager.test.ts, packages/core/tests/integration/bulk-management.test.ts
- **Verification:** type-check passes, all unit tests pass
- **Committed in:** 4ccd27d4

**2. [Rule 1 - Bug] Fixed cache storage only running on empty result path**
- **Found during:** Task 2 (writing cache tests)
- **Issue:** Cache storage code was only in the `!result` early return path — actual aggregation results were never cached
- **Fix:** Restructured getQueueStats() to use single cache storage path for both empty and populated results
- **Files modified:** packages/core/src/scheduler/services/job-query.ts
- **Verification:** All 7 cache tests pass, including cache hit within TTL
- **Committed in:** fbde0b02 (part of Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correctness. The cache bug would have made the entire feature non-functional. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Performance optimization phase complete (both plans executed)
- Ready for Phase 4: Structural Cleanup
- All 295 unit tests passing

---
*Phase: 03-performance-optimization*
*Completed: 2026-02-28*
