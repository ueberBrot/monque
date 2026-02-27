# Project Research Summary

**Project:** Monque — Hardening Milestone
**Domain:** MongoDB-backed job queue library (hardening pass)
**Researched:** 2026-02-27
**Confidence:** HIGH

## Executive Summary

Monque's hardening milestone addresses 9 non-breaking concerns from a codebase audit across performance (bulk operations, stats caching), safety (payload validation, instance ID collision detection), maintainability (facade size reduction, mapper robustness), and test coverage gaps. All 9 improvements can be delivered with **zero new runtime dependencies** — using only Node.js builtins, the existing `mongodb` peer dependency's re-exported `BSON` module, and TypeScript's type system. This is critical: Monque is a published library where every dependency is a burden on consumers.

The recommended approach is a phased build starting with additive test coverage (zero source changes, immediate risk reduction), then layering in safety features (payload validation, instance collision), performance improvements (bulk ops, stats caching), and finishing with structural refactoring (mapper hardening, facade decomposition). This ordering minimizes merge conflict risk and ensures the highest-risk refactor (LifecycleManager extraction) happens last with the full test suite as a safety net.

The primary risks are: (1) bulk operation optimization silently losing per-job state validation if `updateMany` is used without strict status guards — mitigated by a two-phase approach with explicit state filters; (2) instance collision detection false-positiving after crash recovery — mitigated by using heartbeat staleness as the discriminator and running the check after `recoverStaleJobs`; (3) the LifecycleManager extraction breaking timer ownership semantics — mitigated by starting with JSDoc deduplication (zero logic changes) and using the existing shutdown race test suite as the safety net.

## Key Findings

### Recommended Stack

Zero new dependencies. Every improvement uses tools already available in the project.

**Core technologies:**
- **`Map` + lazy expiration** — TTL cache for stats — ~30 lines, no timers, no event loop side effects
- **`BSON.calculateObjectSize` from `mongodb`** — payload size validation — measures exact BSON bytes (what MongoDB actually stores), already available via peer dep
- **`updateMany` (not `bulkWrite`)** — bulk cancel/retry — uniform updates don't need per-doc operations; single round trip
- **TypeScript `satisfies` operator** — mapper robustness — compile-time exhaustiveness check, zero runtime cost
- **Existing `findOne` on jobs collection** — instance collision detection — uses existing `{ claimedBy, status }` index, O(1) lookup

### Expected Features

**Must have (table stakes):**
- **TS-1: Bulk operation optimization** — O(n) → O(1) round trips for cancelJobs/retryJobs via `updateMany`
- **TS-2: Stats caching** — TTL-based in-memory cache for `getQueueStats` aggregation pipeline
- **TS-3: Payload size validation** — optional `maxPayloadSize` using BSON byte calculation
- **TS-4: Instance ID collision detection** — startup query for duplicate `schedulerInstanceId`
- **TS-5: Test coverage gaps** — registerJobs unit tests, aggregation timeout path, concurrent cleanup

**Should have (differentiators):**
- **D-1: Facade size reduction** — JSDoc deduplication via `@see`/`@inheritdoc`, optional LifecycleManager extraction
- **D-2: Mapper robustness** — compile-time `satisfies` guard + exhaustive round-trip test

**Defer (beyond this milestone):**
- Prometheus/metrics export, per-job sizeLimit, persistent worker registry, dead-letter queue, job priority, job progress, job timeouts

### Architecture Approach

The existing architecture (Monque facade → SchedulerContext → 5 internal services) is sound and unchanged by this milestone. All improvements are additive: new internal utilities (`TtlCache`, `InstanceGuard`), new options (`maxPayloadSize`, `statsCacheTtlMs`), one new error type (`PayloadTooLargeError`), and one optional service extraction (`LifecycleManager`). No write paths change. The stats cache is read-only. The SchedulerContext interface is preserved.

**Major components affected:**
1. **JobManager** — `cancelJobs`/`retryJobs` refactored from cursor+findOneAndUpdate to two-phase `updateMany`
2. **JobQueryService** — private TTL cache field for `getQueueStats`, gated by `statsCacheTtlMs` option
3. **JobScheduler** — payload size validation before insert when `maxPayloadSize` configured
4. **Monque (facade)** — instance collision check in `initialize()`, optional LifecycleManager extraction, JSDoc deduplication
5. **documentToPersistedJob** — `satisfies Record<keyof Job<unknown>, FieldSpec>` compile-time guard

### Critical Pitfalls

1. **Bulk ops losing per-job state validation (#1)** — `updateMany` without status guards lets racing jobs get cancelled mid-execution. **Prevent:** strict `{status: 'pending'}` filter in `updateMany`; two-phase approach to detect and report jobs that raced into invalid state.
2. **Instance collision false positives after crash (#3)** — stale processing jobs from a crashed instance trigger collision error on restart. **Prevent:** use heartbeat staleness (`lastHeartbeat > 2×heartbeatInterval`) as discriminator; run check after `recoverStaleJobs`.
3. **Payload validation using JSON instead of BSON (#5)** — JSON and BSON sizes differ (Dates, Binary, ObjectId). **Prevent:** use `BSON.calculateObjectSize` from `mongodb` driver, not `JSON.stringify`.
4. **LifecycleManager breaking timer ownership (#8)** — split ownership of setInterval/clearInterval between Monque and extracted service causes timer leaks. **Prevent:** single owner principle — LifecycleManager fully owns timer lifecycle; start with JSDoc dedup (zero logic) first.
5. **Stats cache unbounded memory (#9)** — per-filter cache entries accumulate without bound. **Prevent:** lazy expiration on `get()`, clear on `stop()`, bound cache size to registered workers + 1.

## Implications for Roadmap

Based on combined research, the milestone naturally splits into 4 phases ordered by risk and dependency.

### Phase 1: Test Coverage Foundation
**Rationale:** Zero source changes — pure additive tests. Validates existing behavior before any modifications. Catches latent bugs that could confuse debugging during later phases.
**Delivers:** Tests for `MonqueModule.registerJobs()`, `getQueueStats` aggregation timeout path, concurrent cleanup/retention.
**Addresses:** TS-5 (test coverage gaps)
**Avoids:** No pitfalls — additive tests only.

### Phase 2: Safety Features
**Rationale:** Low complexity, high impact. Each feature is independent (parallel-safe), adds a new option/error type, touches a single service. No merge conflicts between them.
**Delivers:** `maxPayloadSize` option + `PayloadTooLargeError`, instance collision detection at startup, `JOB_FIELDS` compile-time guard for mapper.
**Addresses:** TS-3 (payload validation), TS-4 (instance collision), D-2 (mapper robustness)
**Avoids:** Pitfall #3 (false positives — heartbeat staleness), Pitfall #5 (JSON vs BSON — use `BSON.calculateObjectSize`), Pitfall #6 (breaking consumers — default `undefined`), Pitfall #7 (mapper drift — `satisfies` guard), Pitfall #12 (over-engineering — compile-time only)

### Phase 3: Performance Optimization
**Rationale:** Medium complexity. Bulk ops touch `JobManager` internals and require updating existing unit test mocks. Stats caching is self-contained in `JobQueryService`. Both deliver measurable perf wins.
**Delivers:** `cancelJobs`/`retryJobs` via `updateMany` (O(n)→O(1)), TTL-cached `getQueueStats` with configurable `statsCacheTtlMs`.
**Addresses:** TS-1 (bulk operations), TS-2 (stats caching)
**Avoids:** Pitfall #1 (state validation — two-phase `updateMany` with status guards), Pitfall #2 (partial failure — handle `MongoBulkWriteError`), Pitfall #4 (stale stats — opt-in, `forceRefresh`), Pitfall #9 (memory leak — bounded cache, lazy eviction), Pitfall #13 (test fragility — update mocks, rely on integration tests)

### Phase 4: Structural Refactoring
**Rationale:** Highest-risk change, touches the most lines. Must come last so all functional changes are complete — avoids rebasing across structural changes. Start with JSDoc deduplication (safe, high impact on line count), then evaluate LifecycleManager extraction.
**Delivers:** Monque facade reduced from ~1250 to ~500 lines. Timer/lifecycle logic extracted if warranted.
**Addresses:** D-1 (facade size reduction)
**Avoids:** Pitfall #8 (SchedulerContext contract — single owner principle, run full test suite per step)

### Phase Ordering Rationale

- **Phase 1 first:** establishes baseline test coverage before any source changes — failing tests during later phases indicate regressions, not pre-existing bugs
- **Phase 2 before Phase 3:** safety features are simpler, each touching one service. This builds confidence in the "additive option" pattern before the more complex bulk ops refactor.
- **Phase 3 before Phase 4:** bulk ops and caching change method internals. If LifecycleManager extraction happened first, these changes would need rebasing across the structural refactor.
- **Phase 4 last:** the facade refactor touches every delegating method's JSDoc. Doing this after all other changes are merged means one clean pass, no merge conflicts.
- **No hard technical dependencies exist** — ordering is strategic (risk management, merge simplicity).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (bulk ops):** The event emission trade-off (fetching IDs before `updateMany` vs count-only events) needs a decision during task planning. Two-phase approach has edge cases around race windows.
- **Phase 4 (structural):** LifecycleManager extraction scope needs validation — the decision to extract vs JSDoc-only should be confirmed during planning based on line-count impact of JSDoc dedup alone.

Phases with standard patterns (skip research):
- **Phase 1 (test gaps):** purely additive tests using existing patterns from `tests/` directory
- **Phase 2 (safety features):** all three features have verified implementation patterns in STACK.md with code examples

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero new deps. All approaches verified against existing mongodb peer dep and Node.js builtins. `BSON.calculateObjectSize` confirmed working in mongodb ^7.1.0. |
| Features | HIGH | Feature list directly from codebase audit CONCERNS.md. Competitor analysis (BullMQ, pg-boss, Agenda, Graphile Worker) validates table-stakes classification. |
| Architecture | HIGH | All changes are additive to existing architecture. No new patterns introduced. `SchedulerContext` injection model preserved. |
| Pitfalls | HIGH | 13 pitfalls identified with clear prevention strategies. Critical pitfalls (#1, #3) have specific integration test detection methods. |

**Overall confidence:** HIGH

### Gaps to Address

- **Event emission for bulk operations:** `updateMany` doesn't return matched document IDs. The recommendation is to fetch IDs before update (O(2) round trips), but this adds a query. Decision needed: is count-only event emission acceptable, or are per-job IDs required? Check existing `jobs:cancelled` / `jobs:retried` event consumers.
- **LifecycleManager extraction scope:** JSDoc deduplication alone may reduce the facade sufficiently (to ~400-500 lines). If so, extracting a LifecycleManager is unnecessary complexity. The decision should be deferred to Phase 4 planning after measuring JSDoc dedup impact.
- **Stats cache `forceRefresh` parameter:** PITFALLS.md recommends a `forceRefresh` option on `getQueueStats`. This changes the method signature (adding an optional parameter). Verify this is non-breaking before implementing.
- **Instance collision: throw vs warn:** STACK.md recommends throwing `ConnectionError`. PITFALLS.md suggests a warning event instead. Recommend: throw by default with a `skipCollisionCheck` option for users who know what they're doing.

## Sources

### Primary (HIGH confidence)
- MongoDB Node.js driver docs — `Collection.updateMany()`, `Collection.bulkWrite()`, `BSON.calculateObjectSize`
- MongoDB docs — 16MB BSON document size limit, `MongoBulkWriteError` structure
- BullMQ API Docs v5.70.1 — class hierarchy, retryJobs, clean, getJobCounts, sizeLimit
- TypeScript 5.9 — `satisfies` operator for compile-time exhaustiveness
- Monque codebase audit — `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md`

### Secondary (MEDIUM confidence)
- pg-boss, Graphile Worker, Agenda docs — competitor feature comparison
- Community patterns — TTL cache with lazy expiration, distributed instance collision detection
- MongoDB community — `calculateObjectSize` edge cases, version drift between `mongodb` and `bson` packages

---
*Research completed: 2026-02-27*
*Ready for roadmap: yes*
