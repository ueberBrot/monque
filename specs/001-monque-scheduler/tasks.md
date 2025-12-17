# Tasks: Monque Job Scheduler Library

**Input**: Design documents from `/specs/001-monque-scheduler/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Included - spec.md specifies 100% test coverage requirement (Constitution Principle I)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Based on plan.md structure (monorepo with Turborepo + Bun workspaces):
- Core package: `packages/core/src/`, `packages/core/tests/`
- Ts.ED package: `packages/tsed/src/`, `packages/tsed/tests/`
- Documentation: `packages/docs/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and monorepo structure

- [X] T001 Run `bun init` at repo root, configure workspaces in package.json for packages/*
- [X] T002 Run `bunx turbo init` to scaffold turbo.json, configure build/test/lint pipelines
- [X] T003 [P] Run `bunx @biomejs/biome init` to scaffold biome.json with recommended rules
- [X] T004 [P] Create docker-compose.yml with MongoDB 4.0+ service for local development
- [X] T005 [P] Run `bunx changeset init` to scaffold .changeset/ directory and config.json
- [X] T006 Run `cd packages/core && bun init` then add mongodb ^6.0.0, cron-parser dependencies
- [X] T007 Run `bunx tsdown --init` in packages/core/ to scaffold tsdown.config.ts (ESM + CJS dual output)
- [X] T008 [P] Create packages/core/tsconfig.json with strict TypeScript 5.x configuration
- [X] T009 Run `cd packages/tsed && bun init` then add @tsed/common, @tsed/di peer dependencies
- [X] T010 Run `bunx tsdown --init` in packages/tsed/ to scaffold tsdown.config.ts (ESM + CJS dual output)
- [X] T011 [P] Create packages/tsed/tsconfig.json with strict TypeScript 5.x configuration
- [X] T012 [P] Run `cd packages/docs && bun init` for minimal workspace placeholder
- [X] T013 Run `bunx vitest init` at root, configure workspace and coverage settings targeting 100%
- [X] T014 Run `bun install` to install all dependencies

---

## Phase 1b: Test Infrastructure (Integration Test Setup)

**Purpose**: Set up MongoDB Testcontainers for integration tests (Phase 3+)

**Why Testcontainers**: Automatic container lifecycle management, isolated test environments, no manual `docker-compose up` required before running tests.

- [X] T014a Run `bun add -d @testcontainers/mongodb` in packages/core/ to add MongoDB Testcontainers
- [X] T014b Create packages/core/tests/setup/mongodb.ts with singleton MongoDBContainer manager:
  - Export `getMongoDb()` async function that starts container on first call, reuses for subsequent calls
  - Export `closeMongoDb()` async function for cleanup
  - Store container instance and MongoClient in module-level variables
  - Container should be shared across all tests in a single test run for performance
- [X] T014c Create packages/core/tests/setup/global-setup.ts for Vitest globalSetup (returns teardown function)
- [X] T014d ~~Create packages/core/tests/setup/global-teardown.ts~~ (merged into T014c - Vitest uses returned function from globalSetup)
- [X] T014e Update packages/core/vitest.config.ts to configure globalSetup hooks and timeouts
- [X] T014f [P] Create packages/core/tests/setup/test-utils.ts with helper functions:
  - `getTestDb(testName)` - returns isolated database per test file
  - `cleanupTestDb(db)` - drops test database after test suite

**Usage Pattern**:
```typescript
// In test files (Phase 3+):
import { getMongoDb, closeMongoDb } from './setup/mongodb';

let db: Db;

beforeAll(async () => {
  db = await getMongoDb();
});

afterAll(async () => {
  // Container stays running, shared across test files
});
```

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, error classes, and utilities that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T015 Create packages/core/src/types.ts with JobStatus const (as const pattern), Job<T> interface from contracts/job-schema.ts
- [X] T016 [P] Add EnqueueOptions, MonqueOptions, WorkerOptions interfaces to packages/core/src/types.ts
- [X] T017 [P] Add MonqueEventMap, JobHandler type, MonquePublicAPI interface to packages/core/src/types.ts
- [X] T018 Create packages/core/src/errors.ts with MonqueError base class
- [X] T019 [P] Add InvalidCronError class (with expression property) to packages/core/src/errors.ts
- [X] T020 [P] Add ConnectionError class to packages/core/src/errors.ts
- [X] T021 [P] Add ShutdownTimeoutError class (with incompleteJobs property) to packages/core/src/errors.ts
- [X] T022 Create packages/core/src/utils/backoff.ts with calculateBackoff function: `nextRunAt = now + (2^failCount × baseInterval)`
- [X] T023 [P] Create packages/core/src/utils/cron.ts with parseExpression wrapper using cron-parser
- [X] T024 Create packages/core/tests/backoff.test.ts with unit tests for backoff calculation
- [X] T025 [P] Create packages/core/tests/cron.test.ts with unit tests for cron parsing
- [X] T026 [P] Create packages/core/tests/errors.test.ts with unit tests for error classes
- [X] T027 Create packages/core/src/monque.ts with Monque class skeleton extending EventEmitter, implementing MonquePublicAPI
- [X] T028 Implement MongoDB collection setup and index creation in Monque constructor (status+nextRunAt, uniqueKey sparse, lockedAt+status)
- [X] T029 Create packages/core/src/index.ts with public exports (types, errors, Monque class)
- [X] T030 Run tests to verify foundational setup passes

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Enqueue and Process One-off Jobs (Priority: P1) 🎯 MVP

**Goal**: Enqueue one-off jobs via `enqueue()` and `now()`, process with registered workers up to concurrency limit

**Independent Test**: Enqueue a job with data, verify registered worker receives and processes it, job status changes to "completed"

### Tests for User Story 1

> **Write tests FIRST, ensure they FAIL before implementation**

- [ ] T031 [P] [US1] Create packages/core/tests/enqueue.test.ts with tests for enqueue() method (basic enqueue, runAt option, return Job, data integrity)
- [ ] T032 [P] [US1] Create packages/core/tests/worker.test.ts with tests for worker() registration and job processing
- [ ] T033 [P] [US1] Create packages/core/tests/locking.test.ts with tests for atomic job locking (concurrent workers, no duplicate processing)
- [ ] T034 [P] [US1] Add concurrency limit tests in packages/core/tests/worker.test.ts (respect defaultConcurrency option)

### Implementation for User Story 1

- [ ] T035 [US1] Implement enqueue<T>(name, data, options) method in packages/core/src/monque.ts (insert job document with status=pending, nextRunAt)
- [ ] T036 [US1] Implement now<T>(name, data) method in packages/core/src/monque.ts (syntactic sugar calling enqueue with runAt=now)
- [ ] T037 [US1] Implement worker<T>(name, handler, options?) method in packages/core/src/monque.ts (store handler in workers Map)
- [ ] T038 [US1] Implement start() method with polling loop in packages/core/src/monque.ts (setInterval based on pollInterval option, default 1000ms)
- [ ] T039 [US1] Implement atomic job locking using findOneAndUpdate in packages/core/src/monque.ts (status=pending, nextRunAt<=now → status=processing, lockedAt=now)
- [ ] T040 [US1] Implement job execution and completion logic in packages/core/src/monque.ts (call handler, set status=completed, updatedAt on success)
- [ ] T041 [US1] Implement concurrency control in packages/core/src/monque.ts (track activeJobs per worker, respect defaultConcurrency=5)
- [ ] T042 [US1] Run tests for US1 to verify all pass

**Checkpoint**: User Story 1 complete - basic job enqueueing and processing works

---

## Phase 4: User Story 2 - Prevent Duplicate Jobs with Unique Keys (Priority: P1)

**Goal**: Use uniqueKey option to prevent duplicate pending/processing jobs

**Independent Test**: Enqueue multiple jobs with same uniqueKey, verify only one exists; verify completed jobs don't block new ones

### Tests for User Story 2

- [ ] T043 [P] [US2] Add tests in packages/core/tests/enqueue.test.ts for uniqueKey deduplication (pending blocks new, processing blocks new, completed allows new)

### Implementation for User Story 2

- [ ] T044 [US2] Implement uniqueKey handling in enqueue() in packages/core/src/monque.ts (upsert with $setOnInsert pattern for pending/processing status check)
- [ ] T045 [US2] Add partial unique index enforcement for uniqueKey (sparse index where uniqueKey exists) in packages/core/src/monque.ts
- [ ] T046 [US2] Run tests for US2 to verify deduplication works correctly

**Checkpoint**: User Story 2 complete - duplicate prevention works independently

---

## Phase 5: User Story 3 - Retry Failed Jobs with Exponential Backoff (Priority: P1)

**Goal**: Failed jobs automatically retry with exponential backoff formula: `nextRunAt = now + (2^failCount × baseInterval)`; permanent failure after maxRetries

**Independent Test**: Create job that fails, verify rescheduled with increasing delays; verify permanent failure after maxRetries (default: 10)

### Tests for User Story 3

- [ ] T047 [P] [US3] Create packages/core/tests/retry.test.ts with tests for retry logic (backoff timing within ±50ms per SC-003)
- [ ] T048 [P] [US3] Add tests for failCount increment, failReason storage in packages/core/tests/retry.test.ts
- [ ] T049 [P] [US3] Add tests for max retries → permanent failed status in packages/core/tests/retry.test.ts

### Implementation for User Story 3

- [ ] T050 [US3] Implement job failure handling in packages/core/src/monque.ts (catch handler errors/rejections, increment failCount, store failReason)
- [ ] T051 [US3] Integrate backoff calculation in failure handling in packages/core/src/monque.ts (use utils/backoff.ts to set nextRunAt, reset status to pending)
- [ ] T052 [US3] Implement max retry check in packages/core/src/monque.ts (if failCount >= maxRetries, set status=failed permanently)
- [ ] T053 [US3] Run tests for US3 to verify retry and backoff behavior

**Checkpoint**: User Story 3 complete - retry with backoff works independently

---

## Phase 6: User Story 4 - Schedule Recurring Jobs with Cron (Priority: P2)

**Goal**: Schedule recurring jobs with 5-field cron expressions; auto-reschedule after successful completion

**Independent Test**: Schedule job with cron expression, verify runs at expected times and re-schedules itself after success

### Tests for User Story 4

- [ ] T054 [P] [US4] Create packages/core/tests/schedule.test.ts with tests for schedule() method (cron parsing, nextRunAt calculation)
- [ ] T055 [P] [US4] Add tests for invalid cron expression (throws InvalidCronError with helpful message) in packages/core/tests/schedule.test.ts
- [ ] T056 [P] [US4] Add tests for recurring job completion (auto-reschedule after success, uses original cron timing after retries) in packages/core/tests/schedule.test.ts

### Implementation for User Story 4

- [ ] T057 [US4] Implement schedule(cronExpression, name, data) method in packages/core/src/monque.ts (validate cron with utils/cron.ts, calculate nextRunAt, store repeatInterval)
- [ ] T058 [US4] Implement re-scheduling logic in job completion handler in packages/core/src/monque.ts (if repeatInterval exists, calculate next run and update job to pending)
- [ ] T059 [US4] Add cron validation with helpful error messages (invalid expression, position of error, valid format example) in packages/core/src/monque.ts
- [ ] T060 [US4] Run tests for US4 to verify recurring job scheduling works

**Checkpoint**: User Story 4 complete - cron scheduling works independently

---

## Phase 7: User Story 5 - Graceful Shutdown (Priority: P2)

**Goal**: stop() method stops polling, waits for in-progress jobs, respects shutdownTimeout (default: 30s)

**Independent Test**: Call stop() while jobs processing, verify all complete before promise resolves; verify timeout emits job:error with ShutdownTimeoutError

### Tests for User Story 5

- [ ] T061 [P] [US5] Create packages/core/tests/shutdown.test.ts with tests for stop() method (stops polling, no new jobs picked up)
- [ ] T062 [P] [US5] Add tests for in-progress job completion waiting in packages/core/tests/shutdown.test.ts
- [ ] T063 [P] [US5] Add tests for shutdown timeout behavior (emit job:error with ShutdownTimeoutError, incompleteJobs array) in packages/core/tests/shutdown.test.ts

### Implementation for User Story 5

- [ ] T064 [US5] Implement stop() method in packages/core/src/monque.ts (clear polling interval, set isRunning=false)
- [ ] T065 [US5] Implement in-progress job tracking and waiting in packages/core/src/monque.ts (track activeJobs Set, wait for all to complete)
- [ ] T066 [US5] Implement shutdown timeout logic with ShutdownTimeoutError emission in packages/core/src/monque.ts (Promise.race with timeout, emit job:error)
- [ ] T067 [US5] Run tests for US5 to verify graceful shutdown works

**Checkpoint**: User Story 5 complete - graceful shutdown works independently

---

## Phase 8: User Story 6 - Monitor Job Lifecycle Events (Priority: P2)

**Goal**: Subscribe to job:start, job:complete (with duration), job:fail (with willRetry), job:error events for observability

**Independent Test**: Subscribe to all events, verify correct events fire at each lifecycle stage within 100ms of state change (SC-005)

### Tests for User Story 6

- [ ] T068 [P] [US6] Create packages/core/tests/events.test.ts with tests for job:start event (fires when processing begins, includes Job)
- [ ] T069 [P] [US6] Add tests for job:complete event (includes Job and duration in ms) in packages/core/tests/events.test.ts
- [ ] T070 [P] [US6] Add tests for job:fail event (includes Job, error, willRetry boolean) in packages/core/tests/events.test.ts
- [ ] T071 [P] [US6] Add tests for job:error event (unexpected errors, includes error and optional job) in packages/core/tests/events.test.ts

### Implementation for User Story 6

- [ ] T072 [US6] Emit job:start event when job begins processing in packages/core/src/monque.ts
- [ ] T073 [US6] Emit job:complete event with duration calculation on success in packages/core/src/monque.ts
- [ ] T074 [US6] Emit job:fail event with error and willRetry flag on failure in packages/core/src/monque.ts
- [ ] T075 [US6] Emit job:error event for unexpected errors (catch unhandled exceptions) in packages/core/src/monque.ts
- [ ] T076 [US6] Implement isHealthy() method returning boolean in packages/core/src/monque.ts (isRunning && db connection active)
- [ ] T076a [P] [US6] Add tests for isHealthy() in packages/core/tests/events.test.ts (returns true when running and connected, false when stopped, false when connection lost)
- [ ] T077 [US6] Run tests for US6 to verify event emission is complete

**Checkpoint**: User Story 6 complete - event monitoring works independently

---

## Phase 9: Stale Job Recovery (Cross-Cutting - FR-026, FR-027)

**Goal**: Recover jobs stuck in "processing" after scheduler crash via lockTimeout (default: 30 minutes)

**Independent Test**: Create stale processing job (lockedAt older than lockTimeout), start scheduler with recoverStaleJobs=true, verify job resets to pending

### Tests for Stale Recovery

- [ ] T078 [P] Create packages/core/tests/stale-recovery.test.ts with tests for stale job detection (lockedAt > lockTimeout)
- [ ] T079 [P] Add tests for stale job recovery on startup (recoverStaleJobs=true resets to pending) in packages/core/tests/stale-recovery.test.ts
- [ ] T080 [P] Add tests for recoverStaleJobs=false option (stale jobs not recovered) in packages/core/tests/stale-recovery.test.ts

### Implementation for Stale Recovery

- [ ] T081 Implement stale job detection query in packages/core/src/monque.ts (status=processing, lockedAt < now - lockTimeout)
- [ ] T082 Implement stale job recovery on start() when recoverStaleJobs=true in packages/core/src/monque.ts (updateMany to reset status=pending, lockedAt=null)
- [ ] T083 Run tests for stale recovery to verify behavior
- [ ] T083a [P] Add integration test for SC-006: multiple scheduler instances processing jobs concurrently without duplicate execution (1000 jobs, 2+ instances, verify each job processed exactly once)

**Checkpoint**: Stale recovery complete - System recovers from scheduler crashes

---

## Phase 10: User Story 7 - Use Decorators for Ts.ED Job Handlers (Priority: P3)

**Goal**: @Job decorator for Ts.ED that auto-registers workers with full DI access

**Independent Test**: Create class with @Job decorator, verify auto-registered when module loads with injected dependencies

### Tests for User Story 7

- [ ] T084 [P] [US7] Create packages/tsed/tests/decorator.test.ts with tests for @Job decorator (metadata storage, class decoration)
- [ ] T085 [P] [US7] Add tests for auto-discovery and registration of decorated handlers in packages/tsed/tests/decorator.test.ts
- [ ] T086 [P] [US7] Add tests for DI injection in job handler classes in packages/tsed/tests/decorator.test.ts

### Implementation for User Story 7

- [ ] T087 [US7] Create packages/tsed/src/decorators/job.ts with JobDecoratorOptions interface and @Job decorator implementation
- [ ] T088 [US7] Create packages/tsed/src/constants.ts with JOB_METADATA_KEY symbol
- [ ] T089 [US7] Implement metadata storage using Reflect.defineMetadata in @Job decorator in packages/tsed/src/decorators/job.ts
- [ ] T090 [US7] Run tests for US7 decorator to verify metadata storage works

**Checkpoint**: User Story 7 partially complete - Decorator works, module integration in US8

---

## Phase 11: User Story 8 - Configure Ts.ED Module with Different Connection Types (Priority: P3)

**Goal**: MonqueModule.forRoot() accepts Mongoose Connection or native MongoDB Db; auto-start/stop on lifecycle

**Independent Test**: Configure module with each connection type, verify jobs can be enqueued and processed with auto-start

### Tests for User Story 8

- [ ] T091 [P] [US8] Create packages/tsed/tests/module.test.ts with tests for MonqueModule.forRoot() configuration
- [ ] T092 [P] [US8] Add tests for Mongoose Connection extraction (connection.db property) in packages/tsed/tests/module.test.ts
- [ ] T093 [P] [US8] Add tests for native Db instance direct usage in packages/tsed/tests/module.test.ts
- [ ] T094 [P] [US8] Add tests for lifecycle hooks (start on init, stop on destroy) in packages/tsed/tests/module.test.ts

### Implementation for User Story 8

- [ ] T095 [US8] Create packages/tsed/src/module.ts with MonqueModuleOptions interface (extends MonqueOptions, adds connection)
- [ ] T096 [US8] Implement connection type detection in packages/tsed/src/module.ts (check for Mongoose Connection.db vs native Db instance)
- [ ] T097 [US8] Implement MonqueModule class with @Module decorator in packages/tsed/src/module.ts
- [ ] T098 [US8] Implement forRoot() static method with DI provider configuration in packages/tsed/src/module.ts
- [ ] T099 [US8] Implement OnInit lifecycle hook calling monque.start() in packages/tsed/src/module.ts (FR-024)
- [ ] T100 [US8] Implement OnDestroy lifecycle hook calling monque.stop() in packages/tsed/src/module.ts (FR-025)
- [ ] T101 [US8] Implement job handler discovery and registration from decorated classes in packages/tsed/src/module.ts
- [ ] T102 [US8] Create packages/tsed/src/index.ts with public exports (MonqueModule, @Job, re-export core types)
- [ ] T103 [US8] Run tests for US8 to verify module configuration and lifecycle hooks

**Checkpoint**: User Story 8 complete - Ts.ED integration fully functional

---

## Phase 12: Polish & Documentation

**Purpose**: Documentation, JSDoc, cleanup, and final validation

### Documentation Tasks

- [ ] T104 [P] Create packages/docs/README.md with documentation index
- [ ] T105 [P] Create packages/docs/getting-started/installation.md based on quickstart.md
- [ ] T106 [P] Create packages/docs/getting-started/quickstart.md with basic usage examples
- [ ] T107 [P] Create packages/docs/getting-started/configuration.md documenting all MonqueOptions
- [ ] T108 [P] Create packages/docs/guides/job-scheduling.md covering one-off, delayed, and cron jobs
- [ ] T109 [P] Create packages/docs/guides/error-handling.md covering custom errors and retry behavior
- [ ] T110 [P] Create packages/docs/guides/graceful-shutdown.md documenting stop() and timeout behavior
- [ ] T111 [P] Create packages/docs/guides/tsed-integration.md for Ts.ED users
- [ ] T112 [P] Create packages/docs/api/monque-class.md with full MonquePublicAPI reference
- [ ] T113 [P] Create packages/docs/api/job-interface.md documenting Job<T> fields
- [ ] T114 [P] Create packages/docs/api/events.md documenting MonqueEventMap events
- [ ] T115 [P] Create packages/docs/api/decorators.md documenting @Job decorator options
- [ ] T116 [P] Create packages/docs/examples/basic-usage.md
- [ ] T117 [P] Create packages/docs/examples/unique-jobs.md
- [ ] T118 [P] Create packages/docs/examples/recurring-jobs.md
- [ ] T119 [P] Create packages/docs/examples/error-retry.md

### Finalization Tasks

- [ ] T120 Add JSDoc documentation to all public APIs in packages/core/src/ (FR-029)
- [ ] T121 [P] Add JSDoc documentation to all public APIs in packages/tsed/src/ (FR-029)
- [ ] T122 Create .github/workflows/release.yml with GitHub Actions release pipeline
- [ ] T123 Run biome lint and format on entire codebase
- [ ] T124 Run full test suite with coverage report (target: 100%)
- [ ] T125 Validate quickstart.md scenarios work end-to-end (SC-001: under 5 minutes)
- [ ] T126 Verify unique key deduplication with 1000 concurrent enqueue attempts (SC-002)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-11)**: All depend on Foundational phase completion
  - US1-US3 (P1): Sequential dependency (US2, US3 build on US1's enqueue/worker)
  - US4-US6 (P2): Can start after US1 completion (build on basic processing)
  - Stale Recovery (Phase 9): Can start after US1 completion
  - US7-US8 (P3): Can start after US1 worker method exists
- **Polish (Phase 12)**: Can start docs after US6 for core; after US8 for Ts.ED

### User Story Dependencies

| Story          | Priority | Depends On                 | Can Start After |
| -------------- | -------- | -------------------------- | --------------- |
| US1            | P1       | Foundational               | T030            |
| US2            | P1       | US1 (enqueue method)       | T035            |
| US3            | P1       | US1 (job execution)        | T040            |
| US4            | P2       | US1 (enqueue, completion)  | T040            |
| US5            | P2       | US1 (polling, activeJobs)  | T041            |
| US6            | P2       | US1 (event infrastructure) | T040            |
| Stale Recovery | -        | US1 (start method)         | T038            |
| US7            | P3       | US1 (worker method)        | T037            |
| US8            | P3       | US7 (decorator complete)   | T090            |

### Within Each User Story

1. Tests MUST be written and FAIL before implementation
2. Implementation follows test requirements
3. Run tests to verify before moving to next story

### Parallel Opportunities

**Phase 1 (Setup):**
- T003, T004, T005 can run in parallel
- T008, T011, T012 can run in parallel (after respective package init)

**Phase 2 (Foundational):**
- T016, T017 can run in parallel (different interfaces)
- T019, T020, T021 can run in parallel (different error classes)
- T023 can run in parallel with T022 (different utility files)
- T024, T025, T026 can run in parallel (different test files)

**User Stories:**
- All tests marked [P] within a story can run in parallel
- US4, US5, US6 can run in parallel with each other after US1
- US7 can run in parallel with US4-US6

**Phase 12 (Documentation):**
- T104-T119 can ALL run in parallel (different files)
- T120, T121 can run in parallel (different packages)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task T031: "Create packages/core/tests/enqueue.test.ts"
Task T032: "Create packages/core/tests/worker.test.ts"
Task T033: "Create packages/core/tests/locking.test.ts"
Task T034: "Add concurrency limit tests"
# Wait for tests to be written, then implement sequentially
```

---

## Implementation Strategy

### MVP First (User Stories 1-3 Only)

1. Complete Phase 1: Setup
2. Complete Phase 1b: Test Infrastructure (Testcontainers setup)
3. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
4. Complete Phase 3: User Story 1 (basic enqueue/process)
5. Complete Phase 4: User Story 2 (unique keys)
6. Complete Phase 5: User Story 3 (retry/backoff)
7. **STOP and VALIDATE**: Test all P1 stories independently
8. Deploy/demo if ready - this is a functional job queue!

### Incremental Delivery

1. Setup + Test Infrastructure + Foundational → Foundation ready
2. Add US1 → Basic job processing works (minimal MVP)
3. Add US2 → Deduplication works
4. Add US3 → Reliability works (P1 complete!)
5. Add Stale Recovery → Crash resilience
6. Add US4 → Cron scheduling works
7. Add US5 → Production-ready shutdown
8. Add US6 → Observability complete (P2 complete!)
9. Add US7 + US8 → Ts.ED integration (P3 complete!)
10. Polish → Production ready

### Parallel Team Strategy (2+ developers)

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - **Developer A**: US1 → US2 → US3 → Stale Recovery (P1 core path)
   - **Developer B**: US7 (after T037) → US8 (P3 Ts.ED path)
3. After P1 complete:
   - **Developer A**: US4, US5, US6 (P2 features)
   - **Developer B**: Documentation (Phase 12)

---

## Notes

- All tasks follow strict checklist format: `- [ ] [TaskID] [P?] [Story?] Description with file path`
- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Verify tests fail before implementing (TDD approach per Constitution)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Integration tests (Phase 3+) use Testcontainers - no manual `docker-compose up` required
- Docker Compose remains available for local development and debugging
- Constitution requires 100% test coverage - all test tasks are mandatory
