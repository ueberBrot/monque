---
phase: 03-performance-optimization
plan: 01
subsystem: database
tags: [mongodb, updateMany, bulk-operations, performance, pipeline-update]

# Dependency graph
requires:
  - phase: 01-test-coverage-foundation
    provides: unit test infrastructure and mock context factory
provides:
  - cancelJobs() via single updateMany call with status guard
  - retryJobs() via pipeline-style updateMany with $rand stagger
  - Count-only bulk event payloads (no jobIds)
affects: [04-structural-cleanup]

# Tech tracking
tech-stack:
  added: []
  patterns: [pipeline-style updateMany with $rand for per-document stagger, status guard override on bulk queries]

key-files:
  created: []
  modified:
    - packages/core/src/scheduler/services/job-manager.ts
    - packages/core/src/events/types.ts
    - packages/core/tests/unit/services/job-manager.test.ts
    - packages/core/tests/integration/bulk-management.test.ts

key-decisions:
  - "Fixed 30s spread window for $rand stagger — avoids extra count query, O(1) round-trips"
  - "Status guard override via query['status'] = ... after buildSelectorQuery — simplest approach, ignores user-supplied status"
  - "Bulk event payloads changed from { jobIds, count } to { count } only — breaking change for event consumers"
  - "Errors array always empty for bulk ops — invalid-state jobs silently skipped by query filter"

patterns-established:
  - "Pipeline-style updateMany: array second argument with $set/$unset stages for complex bulk mutations"
  - "$rand per-document stagger: $add: [new Date(), { $multiply: [{ $rand: {} }, windowMs] }] for thundering herd prevention"

requirements-completed: [PERF-01]

# Metrics
duration: 5min
completed: 2026-02-28
---

# Phase 3 Plan 1: Bulk Operations Summary

**Replaced cursor-based cancelJobs/retryJobs with single updateMany calls — O(1) DB round-trips with pipeline-style $rand stagger for retry thundering herd prevention**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-28T12:47:00Z
- **Completed:** 2026-02-28T12:52:15Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- cancelJobs() reduced from O(n) find+findOneAndUpdate cursor loop to single updateMany with status guard
- retryJobs() reduced to single pipeline-style updateMany with $rand stagger across 30s window
- Bulk event payloads simplified to count-only (removed jobIds array allocation)
- Unit tests rewritten with updateMany mock assertions; integration tests updated for silent skip behavior

## Task Commits

Both tasks committed atomically (pre-commit hook requires type-check across all files):

1. **Task 1 + Task 2: Replace bulk ops with updateMany + update tests** - `4ccd27d4` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/core/src/scheduler/services/job-manager.ts` - cancelJobs() and retryJobs() rewritten with updateMany
- `packages/core/src/events/types.ts` - Removed jobIds from jobs:cancelled and jobs:retried payloads
- `packages/core/tests/unit/services/job-manager.test.ts` - Rewritten bulk cancelJobs/retryJobs describe blocks
- `packages/core/tests/integration/bulk-management.test.ts` - Updated for silent skip behavior, count-only events

## Decisions Made
- Fixed 30s spread window for `$rand` stagger instead of dynamic `min(jobCount * 100ms, 30000ms)` — avoids extra count query, maintains O(1) round-trips. Small batches naturally cluster near 0ms.
- Status guard override approach: `query['status'] = JobStatus.PENDING` after `buildSelectorQuery()` — simplest approach, ignores user-supplied status filter for safety
- Bulk events emit `{ count }` only — breaking change from `{ jobIds, count }` but necessary for O(1) performance (no cursor to collect IDs)
- Errors array always empty for bulk ops — invalid-state jobs silently excluded by the MongoDB query filter

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Combined Task 1 and Task 2 into single commit**
- **Found during:** Task 1 commit attempt
- **Issue:** Pre-commit hook runs `turbo type-check` across all files. Integration tests still referenced old `jobIds` property in event payload types, causing type errors that blocked the commit.
- **Fix:** Completed Task 2 (test updates) before committing, then committed both tasks together
- **Verification:** type-check passes, all unit and integration tests pass
- **Committed in:** 4ccd27d4

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Commit granularity reduced from 2 commits to 1 due to type-check interdependency. No scope creep.

## Issues Encountered
None beyond the commit blocking documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Bulk operations optimized, ready for Plan 2 (stats cache)
- All tests passing with new updateMany-based implementation

---
*Phase: 03-performance-optimization*
*Completed: 2026-02-28*
