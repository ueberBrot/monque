# Phase 1: Test Coverage Foundation - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Fill test gaps for three specific untested code paths: MonqueModule.registerJobs() edge cases (TEST-01), getQueueStats aggregation timeout (TEST-02), and concurrent cleanup behavior (TEST-03). Tests only — no source code changes.

</domain>

<decisions>
## Implementation Decisions

### registerJobs edge cases (TEST-01)
- **Unit tests with mocked injector/monque/logger** — not integration tests. Existing integration tests already cover the happy path.
- **Scope resolution failure**: Mock `injector.get()` returning `undefined` for non-REQUEST scoped controllers. Verify the warn-and-skip behavior (logger.warn called, controller skipped, no error thrown).
- **Duplicate job detection**: Register controllers with colliding `fullName` values. Assert `WorkerRegistrationError` is thrown with the duplicate name.
- **Partial registration error**: Register 3 controllers where the 2nd throws (e.g., duplicate name). Verify the 1st controller's jobs were already registered on the monque mock, and the 3rd controller's jobs were never attempted.
- **Malformed metadata**: Mock `collectJobMetadata` to return entries with missing method names, empty `fullName`, or `isCron: true` without `cronPattern`. Test how `registerJobs()` handles each case.

### Aggregation timeout (TEST-02)
- **Existing unit test already satisfies this requirement.** The test at `job-query.test.ts` mocks `aggregate().toArray()` to throw an error containing `'exceeded time limit'` and asserts `AggregationTimeoutError` is thrown.
- **No changes needed** — verify the existing test passes and mark TEST-02 as satisfied by existing coverage.

### Concurrent cleanup (TEST-03)
- **Integration test with two real Monque instances** against Testcontainers MongoDB, sharing the same collection.
- **Correct behavior** = no data loss, both instances complete cleanup. Old jobs are deleted, recent jobs survive, no deadlocks or corruption.
- **Trigger mechanism**: Short cleanup interval (e.g., 100ms) with `waitFor()` polling to detect when cleanup has occurred. Matches existing `retention.test.ts` pattern.
- **Test both completed and failed retention** simultaneously — insert a mix of old completed, old failed, recent completed, recent failed jobs. Assert old ones deleted, recent ones survive.

### Test file placement
- **TEST-01**: New file `packages/tsed/tests/unit/monque-module.test.ts` for registerJobs unit tests
- **TEST-02**: Existing file `packages/core/tests/unit/services/job-query.test.ts` — no changes
- **TEST-03**: Extend existing file `packages/core/tests/integration/retention.test.ts` with concurrent cleanup scenario

### Claude's Discretion
- Exact mock structure for the Ts.ED injector (how to mock `getProviders`, `get`, `invoke`)
- Number and variety of malformed metadata scenarios
- Specific job counts and timing in the concurrent cleanup test
- Whether to add any helper utilities for the new unit tests

</decisions>

<specifics>
## Specific Ideas

- registerJobs unit tests should mock at the boundary: `injector`, `monque.register()`, `monque.schedule()`, and `logger`
- Concurrent cleanup test follows the existing `retention.test.ts` pattern — insert documents with factory helpers, configure short intervals, use `waitFor()` to poll
- Partial registration test should verify call counts on `monque.register()` to confirm which controllers got through before the error

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-test-coverage-foundation*
*Context gathered: 2026-02-27*
