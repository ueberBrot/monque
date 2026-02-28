---
phase: 04-structural-refactoring
plan: 02
subsystem: refactoring
tags: [lifecycle-manager, timer-management, service-extraction, facade-pattern]

# Dependency graph
requires:
  - phase: 04-structural-refactoring
    plan: 01
    provides: "JSDoc-deduped monque.ts (943 lines) as starting point for extraction"
provides:
  - "LifecycleManager service managing poll, heartbeat, and cleanup timers"
  - "Further reduced Monque facade (865 lines, 33% total reduction)"
  - "15 dedicated unit tests for timer lifecycle and cleanup logic"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Timer callback injection — LifecycleManager receives poll/heartbeat fns rather than importing JobProcessor directly"
    - "Catch-and-emit for background timer errors — consistent with existing service patterns"

key-files:
  created:
    - packages/core/src/scheduler/services/lifecycle-manager.ts
    - packages/core/tests/unit/services/lifecycle-manager.test.ts
  modified:
    - packages/core/src/scheduler/monque.ts
    - packages/core/src/scheduler/services/index.ts
    - packages/core/tests/unit/monque.test.ts

key-decisions:
  - "Callback injection over direct dependency — LifecycleManager takes {poll, updateHeartbeats} callbacks instead of importing JobProcessor, keeping coupling loose"
  - "DEFAULT_RETENTION_INTERVAL as module constant — duplicated the single 3600_000 value rather than importing from Monque defaults"
  - "Mock casting with `as unknown as () => Promise<void>` — matches existing change-stream-handler.test.ts convention for Vitest mock typing"

patterns-established:
  - "Timer callback injection: services accept function callbacks rather than importing sibling services directly"

requirements-completed: [REFR-01]

# Metrics
duration: 7min
completed: 2026-02-28
---

# Phase 4 Plan 02: LifecycleManager Extraction Summary

**Extracted poll/heartbeat/cleanup timer management and cleanupJobs() into LifecycleManager service, reducing Monque facade to 865 lines (33% total reduction from 1294)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-28T14:09:29Z
- **Completed:** 2026-02-28T14:16:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created LifecycleManager service with `startTimers()`, `stopTimers()`, and `cleanupJobs()` methods
- Monque facade now delegates all timer lifecycle to LifecycleManager (removed 3 interval fields + timer setup/teardown code)
- 15 dedicated unit tests covering timer setup, teardown, cleanup logic, and error emission
- Facade equivalence test confirms `lifecycleManager` getter throws before init
- All 310 core unit tests pass, type-check and lint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create LifecycleManager service and extract timer logic** - `f2864c27` (refactor)
2. **Task 2: Add LifecycleManager unit tests and facade equivalence test** - `71cca910` (test)

**Plan metadata:** (pending)

## Files Created/Modified
- `packages/core/src/scheduler/services/lifecycle-manager.ts` - New service: timer management and cleanupJobs (154 lines)
- `packages/core/src/scheduler/services/index.ts` - Added LifecycleManager barrel export
- `packages/core/src/scheduler/monque.ts` - Removed timer fields/logic, delegates to LifecycleManager (865 lines)
- `packages/core/tests/unit/services/lifecycle-manager.test.ts` - 15 test cases for timer lifecycle
- `packages/core/tests/unit/monque.test.ts` - Added LifecycleManager mock + facade equivalence test

## Decisions Made
- **Callback injection over direct dependency:** LifecycleManager takes `{poll, updateHeartbeats}` callbacks instead of importing JobProcessor, keeping coupling loose and testable
- **DEFAULT_RETENTION_INTERVAL as module constant:** Duplicated the single 3600_000 value in lifecycle-manager.ts rather than importing from a shared constants module
- **Mock casting pattern:** Used `as unknown as () => Promise<void>` matching change-stream-handler.test.ts convention for Vitest mock typing issues

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mock typing in lifecycle-manager.test.ts**
- **Found during:** Task 2 (LifecycleManager unit tests)
- **Issue:** `vi.fn().mockResolvedValue(undefined)` returns `Mock<Procedure | Constructable>` which is not assignable to `() => Promise<void>` — TypeScript rejects passing mocks to `startTimers()`
- **Fix:** Applied `as unknown as () => Promise<void>` casting + created `callbacks()` helper for repeated usage, matching the pattern in `change-stream-handler.test.ts`
- **Files modified:** `packages/core/tests/unit/services/lifecycle-manager.test.ts`
- **Verification:** Type-check passes, all 15 tests pass
- **Committed in:** `71cca910` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - typing bug)
**Impact on plan:** Necessary for type-safe tests. No scope creep.

## Issues Encountered

- **Line reduction below 40% target:** Combined Plan 01 + Plan 02 achieved 33.2% reduction (1294 → 865) vs the 40% target (≤776 lines). The gap is because lifecycle method JSDoc (register, start, stop, isHealthy) correctly stays on the facade per CONTEXT.md decisions, and that documentation is substantial. This matches the Plan 01 observation where actual reduction was 27% vs estimated 35%.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 4 (Structural Refactoring) is complete — both plans executed
- All 4 phases of the hardening milestone are done
- Monque facade reduced from 1294 to 865 lines with clean service delegation
- Full test suite: 310 core unit tests + 91 tsed unit tests pass

---
*Phase: 04-structural-refactoring*
*Completed: 2026-02-28*
