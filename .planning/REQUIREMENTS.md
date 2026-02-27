# Requirements: Monque Hardening

**Defined:** 2026-02-27
**Core Value:** Resolve all non-breaking audit concerns — reduce risk for production consumers, improve maintainability for contributors.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Test Coverage

- [x] **TEST-01**: Unit tests cover MonqueModule.registerJobs() edge cases — scope resolution failures, duplicate detection, partial registration errors, malformed metadata
- [x] **TEST-02**: getQueueStats aggregation timeout path has a dedicated unit test that validates AggregationTimeoutError is thrown when MongoDB returns a time limit error
- [x] **TEST-03**: Cleanup/retention feature has a test verifying concurrent Monque instances running cleanup simultaneously on the same collection behave correctly

### Performance

- [ ] **PERF-01**: cancelJobs() and retryJobs() use bulk MongoDB operations (updateMany or bulkWrite) instead of per-document cursor iteration, reducing DB round-trips from O(n) to O(1) for the common case
- [ ] **PERF-02**: getQueueStats() results are cached with a configurable TTL (default 5s), eliminating redundant aggregation pipeline executions for repeated calls within the TTL window

### Security

- [x] **SECR-01**: Optional maxPayloadSize option validates job data payload size before MongoDB insertion, using BSON.calculateObjectSize from the existing mongodb dependency
- [x] **SECR-02**: Startup check during initialize() warns or throws when another active instance is using the same schedulerInstanceId, using heartbeat staleness as the discriminator to avoid false positives after crash recovery

### Refactoring

- [ ] **REFR-01**: Monque facade class is reduced in size by deduplicating JSDoc documentation using @inheritdoc or @see tags, and optionally extracting timer/interval management into a LifecycleManager service
- [x] **REFR-02**: documentToPersistedJob mapper uses an explicit `PersistedJob<T>` return type annotation so that adding a new required field to the Job interface produces a compile error if the mapper is not updated, complemented by round-trip tests that catch optional field drift

## v2 Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Breaking Changes

- **BRKN-01**: Remove deprecated defaultConcurrency and maxConcurrency option aliases
- **BRKN-02**: Add deprecation warnings at construction time when deprecated options are used

### New Features

- **FEAT-01**: Dead-letter queue mechanism for permanently failed jobs
- **FEAT-02**: Job progress tracking for long-running jobs
- **FEAT-03**: Job timeout enforcement during processing (separate from heartbeats)
- **FEAT-04**: Job priority system with compound index

## Out of Scope

| Feature | Reason |
|---------|--------|
| Authentication/authorization middleware | Library consumers' responsibility — by design |
| Mongoose integration in core | Core uses native MongoDB driver only — by design |
| Job priority system | Requires new field + index + polling changes — separate milestone |
| Real-time stats (WebSocket/SSE) | Over-engineering for a library — consumers build their own UI layer |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | Phase 1: Test Coverage Foundation | Complete |
| TEST-02 | Phase 1: Test Coverage Foundation | Complete |
| TEST-03 | Phase 1: Test Coverage Foundation | Complete |
| SECR-01 | Phase 2: Safety & Robustness | Complete |
| SECR-02 | Phase 2: Safety & Robustness | Complete |
| REFR-02 | Phase 2: Safety & Robustness | Complete |
| PERF-01 | Phase 3: Performance Optimization | Pending |
| PERF-02 | Phase 3: Performance Optimization | Pending |
| REFR-01 | Phase 4: Structural Refactoring | Pending |

**Coverage:**
- v1 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 after roadmap creation*
