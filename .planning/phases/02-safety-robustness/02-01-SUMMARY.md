---
phase: 02-safety-robustness
plan: 01
subsystem: api
tags: [bson, payload-validation, type-safety, mapper-exhaustiveness]

# Dependency graph
requires:
  - phase: 01-test-coverage-foundation
    provides: test infrastructure and factory helpers
provides:
  - PayloadTooLargeError with actualSize/maxSize properties
  - maxPayloadSize option on MonqueOptions for BSON byte limit
  - BSON size validation in JobScheduler.enqueue() and schedule()
  - Compile-time mapper exhaustiveness via explicit `PersistedJob<T>` return type annotation
affects: [02-safety-robustness, core-development]

# Tech tracking
tech-stack:
  added: [BSON.calculateObjectSize from mongodb driver]
  patterns: [pre-insert validation, compile-time mapper exhaustiveness via explicit return type]

key-files:
  created:
    - packages/core/tests/unit/payload-size.test.ts
  modified:
    - packages/core/src/shared/errors.ts
    - packages/core/src/shared/index.ts
    - packages/core/src/index.ts
    - packages/core/src/scheduler/types.ts
    - packages/core/src/scheduler/services/types.ts
    - packages/core/src/scheduler/monque.ts
    - packages/core/src/scheduler/services/job-scheduler.ts
    - packages/core/tests/factories/context.ts
    - packages/core/src/jobs/document-to-persisted-job.ts
    - packages/core/tests/unit/document-to-persisted-job.test.ts

key-decisions:
  - "Used BSON.calculateObjectSize({ data }) wrapping data in object to measure real serialized size"
  - "Relied on explicit PersistedJob<T> return type annotation for mapper exhaustiveness — zero extra type machinery, TypeScript catches missing required fields naturally"

patterns-established:
  - "Pre-insert validation pattern: validate before any MongoDB operation, throw domain error"
  - "Compile-time mapper exhaustiveness: explicit PersistedJob<T> return type + round-trip tests for optional field coverage"

requirements-completed: [SECR-01, REFR-02]

# Metrics
duration: 6min
completed: 2026-02-27
---

# Phase 02 Plan 01: Payload Size Validation & Mapper Exhaustiveness Summary

**BSON payload size guard via `maxPayloadSize` option and compile-time mapper exhaustiveness via explicit `PersistedJob<T>` return type on `documentToPersistedJob`**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-27T21:06:22Z
- **Completed:** 2026-02-27T21:12:34Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- `PayloadTooLargeError` class with `actualSize` and `maxSize` readonly properties, exported from `@monque/core`
- `maxPayloadSize` option on `MonqueOptions` with BSON byte validation in `JobScheduler.enqueue()` and `schedule()` before any MongoDB insertion
- Explicit `PersistedJob<T>` return type annotation on `documentToPersistedJob` — adding a required field to `Job` without updating the mapper produces a compile error. Round-trip tests catch optional field drift at runtime
- 6 new unit tests (4 payload-size, 2 complete field mapping) — all 288 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PayloadTooLargeError, maxPayloadSize option, and BSON size validation** - `16667761` (feat)
2. **Task 2: Verify mapper exhaustiveness via explicit return type on documentToPersistedJob** - `db616fb7` (feat)

**Plan metadata:** [pending] (docs: complete plan)

## Files Created/Modified
- `packages/core/src/shared/errors.ts` - Added `PayloadTooLargeError` class
- `packages/core/src/shared/index.ts` - Re-exported `PayloadTooLargeError`
- `packages/core/src/index.ts` - Public API export of `PayloadTooLargeError`
- `packages/core/src/scheduler/types.ts` - Added `maxPayloadSize` to `MonqueOptions`
- `packages/core/src/scheduler/services/types.ts` - Added `maxPayloadSize` to `ResolvedMonqueOptions`
- `packages/core/src/scheduler/monque.ts` - Pass-through `maxPayloadSize` in constructor
- `packages/core/src/scheduler/services/job-scheduler.ts` - Added `validatePayloadSize()` method, calls in `enqueue()` and `schedule()`
- `packages/core/tests/factories/context.ts` - Added `maxPayloadSize: undefined` to test defaults
- `packages/core/tests/unit/payload-size.test.ts` - 4 unit tests for payload size validation
- `packages/core/src/jobs/document-to-persisted-job.ts` - Verified explicit `PersistedJob<T>` return type provides compile-time exhaustiveness
- `packages/core/tests/unit/document-to-persisted-job.test.ts` - 2 complete field mapping tests

## Decisions Made
- Used `BSON.calculateObjectSize({ data })` wrapping data in an object to measure actual serialized BSON size, matching what MongoDB stores
- Relied on explicit `PersistedJob<T>` return type annotation for mapper exhaustiveness — the function's return type already enforces that all required fields are present in the object literal, and round-trip tests provide runtime coverage for optional fields

## Deviations from Plan

None.

---

**Total deviations:** 0

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Payload size validation and mapper exhaustiveness both complete
- Ready for Plan 02 (remaining safety/robustness items)
- All 288 unit tests pass, type-check clean, lint clean

---
*Phase: 02-safety-robustness*
*Completed: 2026-02-27*
