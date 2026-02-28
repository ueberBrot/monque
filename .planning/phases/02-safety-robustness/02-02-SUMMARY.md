---
phase: 02-safety-robustness
plan: 02
subsystem: testing
tags: [instance-collision, heartbeat, connectionerror, testcontainers, vitest]

# Dependency graph
requires:
  - phase: 02-safety-robustness
    provides: "checkInstanceCollision() method in Monque.initialize()"
provides:
  - "Unit tests for instance collision detection (8 tests)"
  - "Integration tests for instance collision detection (3 tests)"
  - "Fixed monque.test.ts mock for collision check compatibility"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Direct collection.insertOne for simulating crashed instance state in integration tests"
    - "waitFor + heartbeat timing for testing active instance detection"

key-files:
  created:
    - packages/core/tests/unit/instance-collision.test.ts
    - packages/core/tests/integration/instance-collision.test.ts
  modified:
    - packages/core/tests/unit/monque.test.ts

key-decisions:
  - "Added findOne mock to existing monque.test.ts to fix 12 pre-existing failures caused by collision check calling collection.findOne"

patterns-established:
  - "Insert fake processing documents with old timestamps to simulate crashed instances in integration tests"

requirements-completed: [SECR-02]

# Metrics
duration: 4min
completed: 2026-02-27
---

# Phase 2 Plan 2: Instance Collision Detection Summary

**Unit + integration tests verifying schedulerInstanceId collision detection during initialize() with heartbeat staleness discrimination**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-27T21:15:47Z
- **Completed:** 2026-02-27T21:20:24Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- 8 unit tests covering collision throws, error messages, query shape, stale heartbeat handling, collection unavailability, execution order, and default UUID safety
- 3 integration tests with real MongoDB via Testcontainers: active collision rejection, clean shutdown reuse, crash recovery with stale heartbeat
- Fixed pre-existing monque.test.ts mock to include findOne for collision check compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Unit tests for checkInstanceCollision()** - `8247e924` (test)
2. **Task 2: Integration tests for instance collision detection** - `07b85e7b` (test)
3. **Deviation fix: monque.test.ts findOne mock** - `a1452173` (fix)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `packages/core/tests/unit/instance-collision.test.ts` - 8 unit tests for collision detection logic with mocked collection
- `packages/core/tests/integration/instance-collision.test.ts` - 3 integration tests with real MongoDB (active collision, clean stop, crash recovery)
- `packages/core/tests/unit/monque.test.ts` - Added `findOne: vi.fn().mockResolvedValue(null)` to mock collection

## Decisions Made
- Added `findOne` returning `null` to the existing monque.test.ts mock collection — collision check needs this method, and returning null matches the "no collision" default behavior

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added findOne mock to monque.test.ts**
- **Found during:** Verification (full unit test suite run after Task 2)
- **Issue:** Existing monque.test.ts mock collection lacked `findOne`, causing 12 test failures when `checkInstanceCollision()` is called during `initialize()`
- **Fix:** Added `findOne: vi.fn().mockResolvedValue(null)` to the mock collection in beforeEach
- **Files modified:** `packages/core/tests/unit/monque.test.ts`
- **Verification:** All 289 unit tests pass (17 files, 0 failures)
- **Committed in:** `a1452173`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix — existing tests broken by collision check feature. No scope creep.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 2 (Safety & Robustness) is now complete with both plans executed
- All collision detection functionality tested at unit and integration levels
- Ready to proceed to Phase 3 (Observability & DX)

## Self-Check: PASSED

All files exist, all commits verified:
- ✅ `packages/core/tests/unit/instance-collision.test.ts`
- ✅ `packages/core/tests/integration/instance-collision.test.ts`
- ✅ `.planning/phases/02-safety-robustness/02-02-SUMMARY.md`
- ✅ Commit `8247e924` (Task 1)
- ✅ Commit `07b85e7b` (Task 2)
- ✅ Commit `a1452173` (Deviation fix)

---
*Phase: 02-safety-robustness*
*Completed: 2026-02-27*
