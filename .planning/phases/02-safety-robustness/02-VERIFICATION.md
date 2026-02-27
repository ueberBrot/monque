---
phase: 02-safety-robustness
verified: 2026-02-27T22:25:00Z
status: passed
score: 6/6 must-haves verified
---

# Phase 02: Safety & Robustness Verification Report

**Phase Goal:** Library consumers have opt-in protection against oversized payloads, instance ID collisions, and mapper drift
**Verified:** 2026-02-27T22:25:00Z
**Status:** ✅ PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Configuring `maxPayloadSize` causes jobs exceeding the BSON byte limit to be rejected with PayloadTooLargeError before MongoDB insertion | ✓ VERIFIED | `validatePayloadSize()` in `job-scheduler.ts:31-45` called at top of `enqueue()` (L93) and `schedule()` (L232), before any MongoDB operation. Uses `BSON.calculateObjectSize()`. 4 unit tests pass. |
| 2 | Jobs within the size limit are enqueued normally when maxPayloadSize is configured | ✓ VERIFIED | Unit test "allows payload within maxPayloadSize on enqueue" passes — `maxPayloadSize=10000`, small data enqueued successfully. |
| 3 | When maxPayloadSize is not configured, no size check occurs (backward compatible) | ✓ VERIFIED | `validatePayloadSize()` returns immediately if `maxSize === undefined` (L33-35). Unit test "skips validation when maxPayloadSize is undefined" passes with large data. |
| 4 | Starting a second Monque instance with same schedulerInstanceId while first is active throws ConnectionError | ✓ VERIFIED | `checkInstanceCollision()` in `monque.ts:362-384` queries for processing jobs with recent heartbeat claimed by same ID. Called in `initialize()` at L181 after stale recovery. 8 unit tests + 3 integration tests pass. |
| 5 | No false positive after crash recovery — stale heartbeats do not trigger collision detection | ✓ VERIFIED | `checkInstanceCollision()` runs AFTER `recoverStaleJobs()` (L176-181). Stale recovery resets old processing jobs to pending, so collision check finds nothing. Integration test "allows second instance after crash recovery (stale heartbeat)" verifies this with real MongoDB. |
| 6 | Adding a new required field to Job interface without updating documentToPersistedJob produces a TypeScript compile error | ✓ VERIFIED | Explicit `PersistedJob<T>` return type annotation on the mapper function in `document-to-persisted-job.ts:17`. The object literal assigned to `const job: PersistedJob<T>` must satisfy all required fields — omitting one causes `tsc` to error. Round-trip tests (`document-to-persisted-job.test.ts:15-57`) catch optional field drift at runtime. Manual test: adding `testField: string` to `Job` produces compile error on the mapper's object literal. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/shared/errors.ts` | PayloadTooLargeError class | ✓ VERIFIED | L243-256: Class with `actualSize`, `maxSize` readonly properties, extends `MonqueError` |
| `packages/core/src/scheduler/types.ts` | maxPayloadSize option | ✓ VERIFIED | L177-186: `maxPayloadSize?: number \| undefined` with TSDoc |
| `packages/core/src/scheduler/services/job-scheduler.ts` | Size validation before insert | ✓ VERIFIED | L31-45: `validatePayloadSize()` using `BSON.calculateObjectSize`, called in `enqueue()` and `schedule()` |
| `packages/core/src/jobs/document-to-persisted-job.ts` | Exhaustiveness via explicit return type | ✓ VERIFIED | L17: `PersistedJob<T>` return type annotation — TypeScript errors on missing required fields in the object literal |
| `packages/core/src/scheduler/monque.ts` | Instance collision detection | ✓ VERIFIED | L362-384: `checkInstanceCollision()`, called at L181 in `initialize()` |
| `packages/core/src/scheduler/services/types.ts` | maxPayloadSize in ResolvedMonqueOptions | ✓ VERIFIED | L22,29: Excluded from `Required<Omit<...>>`, included in `Pick<...>` |
| `packages/core/tests/unit/payload-size.test.ts` | Unit tests (≥40 lines) | ✓ VERIFIED | 69 lines, 4 tests, all passing |
| `packages/core/tests/unit/document-to-persisted-job.test.ts` | Exhaustiveness tests (≥20 lines) | ✓ VERIFIED | 189 lines, 8 tests, all passing |
| `packages/core/tests/unit/instance-collision.test.ts` | Unit tests (≥50 lines) | ✓ VERIFIED | 194 lines, 8 tests, all passing |
| `packages/core/tests/integration/instance-collision.test.ts` | Integration tests (≥40 lines) | ✓ VERIFIED | 184 lines, 3 tests |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `job-scheduler.ts` | `BSON.calculateObjectSize` | import from mongodb | ✓ WIRED | L1: `import { BSON, type Document } from 'mongodb'`; L37: `BSON.calculateObjectSize({ data } as Document)` |
| `job-scheduler.ts` | `PayloadTooLargeError` | throws on oversized payload | ✓ WIRED | L10: imported from `@/shared`; L39-44: `throw new PayloadTooLargeError(...)` |
| `document-to-persisted-job.ts` | `PersistedJob` | explicit return type | ✓ WIRED | L17: `): PersistedJob<T>` return type annotation ensures required field completeness at compile time |
| `monque.ts` | `collection.findOne` | heartbeat staleness query | ✓ WIRED | L371-375: `this.collection.findOne({ claimedBy: ..., status: ..., lastHeartbeat: { $gte: ... } })` |
| `monque.ts` | `maxPayloadSize` | passed to ResolvedMonqueOptions | ✓ WIRED | L152: `maxPayloadSize: options.maxPayloadSize` in constructor |
| `src/index.ts` | `PayloadTooLargeError` | public API export | ✓ WIRED | L46: exported from `@/shared` |
| `src/shared/index.ts` | `PayloadTooLargeError` | barrel re-export | ✓ WIRED | L8: `PayloadTooLargeError` in export list from `./errors.js` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SECR-01 | 02-01-PLAN | Optional maxPayloadSize validates BSON size before insertion | ✓ SATISFIED | `validatePayloadSize()` in JobScheduler, `PayloadTooLargeError`, 4 unit tests |
| SECR-02 | 02-02-PLAN | Startup collision check using heartbeat staleness | ✓ SATISFIED | `checkInstanceCollision()` in Monque.initialize(), 8 unit + 3 integration tests |
| REFR-02 | 02-01-PLAN | Compile-time exhaustiveness on mapper via explicit return type | ✓ SATISFIED | `PersistedJob<T>` return type annotation, verified via manual tsc test adding required field to Job |

No orphaned requirements found — all 3 requirement IDs (SECR-01, SECR-02, REFR-02) from REQUIREMENTS.md are covered by plans and verified.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None found | — | — |

No TODOs, FIXMEs, placeholders, empty implementations, or console.log calls in any phase 02 source files.

### Human Verification Required

None required. All three success criteria verified programmatically:
1. Payload size validation — unit tests confirm throws/allows correctly
2. Instance collision detection — unit + integration tests confirm throws/allows correctly
3. Exhaustiveness guard — explicit `PersistedJob<T>` return type annotation catches missing required fields at compile time, round-trip tests catch optional field drift

### Gaps Summary

No gaps found. All 6 observable truths verified, all artifacts exist with substantive implementations and proper wiring, all 3 requirements satisfied.

**Test results:**
- 289/289 unit tests pass (17 test files)
- `tsc --noEmit` passes cleanly
- All 5 documented commits verified

---

_Verified: 2026-02-27T22:25:00Z_
_Verifier: Claude (gsd-verifier)_
