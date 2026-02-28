# Roadmap: Monque Hardening

## Overview

Systematic hardening pass resolving 9 non-breaking audit concerns across test coverage, safety, performance, and maintainability. Ordered by risk: additive tests first (safety net), then safety features, then performance optimizations, then structural refactoring last (highest risk, most test coverage available).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Test Coverage Foundation** - Fill test gaps for registerJobs, aggregation timeout, and concurrent cleanup
- [x] **Phase 2: Safety & Robustness** - Add payload size validation, instance collision detection, and mapper exhaustiveness via explicit return type (completed 2026-02-27)
- [x] **Phase 3: Performance Optimization** - Bulk operations for cancel/retry and TTL-cached queue stats (completed 2026-02-28)
- [ ] **Phase 4: Structural Refactoring** - Reduce Monque facade size via JSDoc deduplication and optional LifecycleManager extraction

## Phase Details

### Phase 1: Test Coverage Foundation
**Goal**: Existing behavior is fully covered by tests before any source changes begin
**Depends on**: Nothing (first phase)
**Requirements**: TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. MonqueModule.registerJobs() tests cover scope resolution failure, duplicate job detection, partial registration error, and malformed metadata — all pass
  2. A unit test exercises the getQueueStats aggregation timeout path and verifies AggregationTimeoutError is thrown
  3. An integration test runs two Monque instances executing cleanup simultaneously on the same collection without data corruption or deadlocks
**Plans:** 2 plans
Plans:
- [x] 01-01-PLAN.md — registerJobs() unit tests (TEST-01) + verify TEST-02 existing coverage
- [x] 01-02-PLAN.md — Concurrent cleanup integration test (TEST-03)

### Phase 2: Safety & Robustness
**Goal**: Library consumers have opt-in protection against oversized payloads, instance ID collisions, and mapper drift
**Depends on**: Phase 1
**Requirements**: SECR-01, SECR-02, REFR-02
**Success Criteria** (what must be TRUE):
  1. Configuring `maxPayloadSize` causes jobs exceeding the BSON byte limit to be rejected with a PayloadTooLargeError before MongoDB insertion
  2. Starting a second Monque instance with the same schedulerInstanceId while the first is active throws a ConnectionError (or warns), with no false positives after crash recovery
  3. Adding a new required field to the Job interface without updating documentToPersistedJob produces a TypeScript compile error via the explicit `PersistedJob<T>` return type annotation, and round-trip tests catch optional field drift
**Plans:** 2/2 plans complete
Plans:
- [x] 02-01-PLAN.md — Payload size validation (SECR-01) + mapper exhaustiveness via explicit return type (REFR-02)
- [x] 02-02-PLAN.md — Instance collision detection (SECR-02)

### Phase 3: Performance Optimization
**Goal**: Bulk job operations and stats queries perform with O(1) DB round-trips instead of O(n)
**Depends on**: Phase 1
**Requirements**: PERF-01, PERF-02
**Success Criteria** (what must be TRUE):
  1. cancelJobs() and retryJobs() use updateMany (or bulkWrite) with proper status guards, completing in a single DB round-trip regardless of job count
  2. Repeated getQueueStats() calls within the TTL window return cached results without re-executing the aggregation pipeline
  3. Stats cache respects configurable `statsCacheTtlMs` option, clears on stop(), and does not grow unbounded
**Plans:** 2/2 plans complete
Plans:
- [x] 03-01-PLAN.md — Bulk cancelJobs/retryJobs via updateMany (PERF-01)
- [x] 03-02-PLAN.md — TTL+LRU cache for getQueueStats (PERF-02)

### Phase 4: Structural Refactoring
**Goal**: Monque facade class is significantly smaller and easier to maintain without changing any public behavior
**Depends on**: Phase 1, Phase 2, Phase 3
**Requirements**: REFR-01
**Success Criteria** (what must be TRUE):
  1. Monque class file is reduced by at least 40% in line count through JSDoc deduplication (@see/@inheritdoc) and/or LifecycleManager extraction
  2. Full existing test suite passes with zero modifications (behavioral equivalence confirmed)
**Plans:** 2 plans
Plans:
- [x] 04-01-PLAN.md — JSDoc deduplication via @inheritdoc (subtractive, measurable)
- [ ] 04-02-PLAN.md — LifecycleManager extraction (timer/interval management + cleanupJobs)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4
(Phases 2 and 3 depend only on Phase 1, but sequential execution avoids merge conflicts)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Test Coverage Foundation | 2/2 | Complete | 2026-02-27 |
| 2. Safety & Robustness | 2/2 | Complete   | 2026-02-27 |
| 3. Performance Optimization | 2/2 | Complete | 2026-02-28 |
| 4. Structural Refactoring | 1/2 | In progress | - |
