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

## Legacy/Completed Phases (Phases 1-9) ✅

### Phase 1: Setup (Shared Infrastructure) ✅ COMPLETED

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

## Phase 3: User Story 1 - Enqueue and Process One-off Jobs (Priority: P1) 🎯 MVP (COMPLETED)

**Goal**: Enqueue one-off jobs via `enqueue()` and `now()`, process with registered workers up to concurrency limit

**Independent Test**: Enqueue a job with data, verify registered worker receives and processes it, job status changes to "completed"

### Tests for User Story 1

> **Write tests FIRST, ensure they FAIL before implementation**

- [X] T031 [P] [US1] Create packages/core/tests/enqueue.test.ts with tests for enqueue() method (basic enqueue, runAt option, return Job, data integrity)
- [X] T032 [P] [US1] Create packages/core/tests/worker.test.ts with tests for worker() registration and job processing
- [X] T033 [P] [US1] Create packages/core/tests/locking.test.ts with tests for atomic job locking (concurrent workers, no duplicate processing)
- [X] T034 [P] [US1] Add concurrency limit tests in packages/core/tests/worker.test.ts (respect defaultConcurrency option)

### Implementation for User Story 1

- [X] T035 [US1] Implement enqueue<T>(name, data, options) method in packages/core/src/monque.ts (insert job document with status=pending, nextRunAt)
- [X] T036 [US1] Implement now<T>(name, data) method in packages/core/src/monque.ts (syntactic sugar calling enqueue with runAt=now)
- [X] T037 [US1] Implement worker<T>(name, handler, options?) method in packages/core/src/monque.ts (store handler in workers Map)
- [X] T038 [US1] Implement start() method with polling loop in packages/core/src/monque.ts (setInterval based on pollInterval option, default 1000ms)
- [X] T039 [US1] Implement atomic job locking using findOneAndUpdate in packages/core/src/monque.ts (status=pending, nextRunAt<=now → status=processing, lockedAt=now)
- [X] T040 [US1] Implement job execution and completion logic in packages/core/src/monque.ts (call handler, set status=completed, updatedAt on success)
- [X] T041 [US1] Implement concurrency control in packages/core/src/monque.ts (track activeJobs per worker, respect defaultConcurrency=5)
- [X] T042 [US1] Run tests for US1 to verify all pass

**Checkpoint**: User Story 1 complete - basic job enqueueing and processing works

---

## Phase 4: User Story 2 - Prevent Duplicate Jobs with Unique Keys (Priority: P1)

**Goal**: Use uniqueKey option to prevent duplicate pending/processing jobs

**Independent Test**: Enqueue multiple jobs with same uniqueKey, verify only one exists; verify completed jobs don't block new ones

### Tests for User Story 2

- [X] T043 [P] [US2] Add tests in packages/core/tests/enqueue.test.ts for uniqueKey deduplication (pending blocks new, processing blocks new, completed allows new)

### Implementation for User Story 2

- [X] T044 [US2] Implement uniqueKey handling in enqueue() in packages/core/src/monque.ts (upsert with $setOnInsert pattern for pending/processing status check)
- [X] T045 [US2] Add partial unique index enforcement for uniqueKey (sparse index where uniqueKey exists) in packages/core/src/monque.ts
- [X] T046 [US2] Run tests for US2 to verify deduplication works correctly

**Checkpoint**: User Story 2 complete - duplicate prevention works independently

---

## Phase 5: User Story 3 - Retry Failed Jobs with Exponential Backoff (Priority: P1) (COMPLETED)

**Goal**: Failed jobs automatically retry with exponential backoff formula: `nextRunAt = now + (2^failCount × baseInterval)`; permanent failure after maxRetries

**Independent Test**: Create job that fails, verify rescheduled with increasing delays; verify permanent failure after maxRetries (default: 10)

### Tests for User Story 3

- [X] T047 [P] [US3] Create packages/core/tests/retry.test.ts with tests for retry logic (backoff timing within ±50ms per SC-003)
- [X] T048 [P] [US3] Add tests for failCount increment, failReason storage in packages/core/tests/retry.test.ts
- [X] T049 [P] [US3] Add tests for max retries → permanent failed status in packages/core/tests/retry.test.ts

### Implementation for User Story 3

- [X] T050 [US3] Implement job failure handling in packages/core/src/monque.ts (catch handler errors/rejections, increment failCount, store failReason)
- [X] T051 [US3] Integrate backoff calculation in failure handling in packages/core/src/monque.ts (use utils/backoff.ts to set nextRunAt, reset status to pending)
- [X] T052 [US3] Implement max retry check in packages/core/src/monque.ts (if failCount >= maxRetries, set status=failed permanently)
- [X] T053 [US3] Run tests for US3 to verify retry and backoff behavior

**Checkpoint**: User Story 3 complete - retry with backoff works independently

---

## Phase 6: User Story 4 - Schedule Recurring Jobs with Cron (Priority: P2)

**Goal**: Schedule recurring jobs with 5-field cron expressions; auto-reschedule after successful completion

**Independent Test**: Schedule job with cron expression, verify runs at expected times and re-schedules itself after success

### Tests for User Story 4

- [X] T054 [P] [US4] Create packages/core/tests/schedule.test.ts with tests for schedule() method (cron parsing, nextRunAt calculation)
- [X] T055 [P] [US4] Add tests for invalid cron expression (throws InvalidCronError with helpful message) in packages/core/tests/schedule.test.ts
- [X] T056 [P] [US4] Add tests for recurring job completion (auto-reschedule after success, uses original cron timing after retries) in packages/core/tests/schedule.test.ts

### Implementation for User Story 4

- [X] T057 [US4] Implement schedule(cronExpression, name, data) method in packages/core/src/monque.ts (validate cron with utils/cron.ts, calculate nextRunAt, store repeatInterval)
- [X] T058 [US4] Implement re-scheduling logic in job completion handler in packages/core/src/monque.ts (if repeatInterval exists, calculate next run and update job to pending)
- [X] T059 [US4] Add cron validation with helpful error messages (invalid expression, position of error, valid format example) in packages/core/src/monque.ts
- [X] T060 [US4] Run tests for US4 to verify recurring job scheduling works

**Checkpoint**: User Story 4 complete - cron scheduling works independently

---

## Phase 7: User Story 5 - Graceful Shutdown (Priority: P3) (COMPLETED)

**Goal**: stop() method stops polling, waits for in-progress jobs, respects shutdownTimeout (default: 30s)

**Independent Test**: Call stop() while jobs processing, verify all complete before promise resolves; verify timeout emits job:error with ShutdownTimeoutError

### Tests for User Story 5

- [X] T061 [P] [US5] Create packages/core/tests/shutdown.test.ts with tests for stop() method (stops polling, no new jobs picked up)
- [X] T062 [P] [US5] Add tests for in-progress job completion waiting in packages/core/tests/shutdown.test.ts
- [X] T063 [P] [US5] Add tests for shutdown timeout behavior (emit job:error with ShutdownTimeoutError, incompleteJobs array) in packages/core/tests/shutdown.test.ts

### Implementation for User Story 5

- [X] T064 [US5] Implement stop() method in packages/core/src/monque.ts (clear polling interval, set isRunning=false)
- [X] T065 [US5] Implement in-progress job tracking and waiting in packages/core/src/monque.ts (track activeJobs Set, wait for all to complete)
- [X] T066 [US5] Implement shutdown timeout logic with ShutdownTimeoutError emission in packages/core/src/monque.ts (Promise.race with timeout, emit job:error)
- [X] T067 [US5] Run tests for US5 to verify graceful shutdown works

**Checkpoint**: User Story 5 complete - graceful shutdown works independently ✅

---

## Phase 8: User Story 6 - Monitor Job Lifecycle Events (Priority: P2) (COMPLETED)

**Goal**: Subscribe to job:start, job:complete (with duration), job:fail (with willRetry), job:error events for observability

**Independent Test**: Subscribe to all events, verify correct events fire at each lifecycle stage within 100ms of state change (SC-005)

### Tests for User Story 6

- [X] T068 [P] [US6] Create packages/core/tests/events.test.ts with tests for job:start event (fires when processing begins, includes Job)
- [X] T069 [P] [US6] Add tests for job:complete event (includes Job and duration in ms) in packages/core/tests/events.test.ts
- [X] T070 [P] [US6] Add tests for job:fail event (includes Job, error, willRetry boolean) in packages/core/tests/events.test.ts
- [X] T071 [P] [US6] Add tests for job:error event (unexpected errors, includes error and optional job) in packages/core/tests/events.test.ts

### Implementation for User Story 6

- [X] T072 [US6] Emit job:start event when job begins processing in packages/core/src/monque.ts
- [X] T073 [US6] Emit job:complete event with duration calculation on success in packages/core/src/monque.ts
- [X] T074 [US6] Emit job:fail event with error and willRetry flag on failure in packages/core/src/monque.ts
- [X] T075 [US6] Emit job:error event for unexpected errors (catch unhandled exceptions) in packages/core/src/monque.ts
- [X] T076 [US6] Implement isHealthy() method returning boolean in packages/core/src/monque.ts (isRunning && db connection active)
- [X] T076a [P] [US6] Add tests for isHealthy() in packages/core/tests/events.test.ts (returns true when running and connected, false when stopped, false when connection lost)
- [X] T077 [US6] Run tests for US6 to verify event emission is complete

**Checkpoint**: User Story 6 complete - event monitoring works independently

---

## Phase 9: Stale Job Recovery (Cross-Cutting - FR-026, FR-027) (COMPLETED)

**Goal**: Recover jobs stuck in "processing" after scheduler crash via lockTimeout (default: 30 minutes)

**Independent Test**: Create stale processing job (lockedAt older than lockTimeout), start scheduler with recoverStaleJobs=true, verify job resets to pending

### Tests for Stale Recovery

- [X] T078 [P] Create packages/core/tests/stale-recovery.test.ts with tests for stale job detection (lockedAt > lockTimeout)
- [X] T079 [P] Add tests for stale job recovery on startup (recoverStaleJobs=true resets to pending) in packages/core/tests/stale-recovery.test.ts
- [X] T080 [P] Add tests for recoverStaleJobs=false option (stale jobs not recovered) in packages/core/tests/stale-recovery.test.ts

### Implementation for Stale Recovery

- [X] T081 Implement stale job detection query in packages/core/src/monque.ts (status=processing, lockedAt < now - lockTimeout)
- [X] T082 Implement stale job recovery on start() when recoverStaleJobs=true in packages/core/src/monque.ts (updateMany to reset status=pending, lockedAt=null)
- [X] T083 Run tests for stale recovery to verify behavior
- [X] T083a [P] Add integration test for SC-006: multiple scheduler instances processing jobs concurrently without duplicate execution (1000 jobs, 2+ instances, verify each job processed exactly once)

**Checkpoint**: Stale recovery complete - System recovers from scheduler crashes

---
## NEW DEVELOPMENT PHASES (Phase 10+)

The following phases represent the refactor to atomic claim pattern with MongoDB Change Streams.

> [!IMPORTANT]
> **Breaking Changes Allowed**: Since the library has not been publicly released:
> - **No backwards compatibility is required** for any changes in Phases 10+
> - **Existing tests must be updated** to reflect new implementations
> - **New tests must be added** for new functionality
> - This applies to all type changes, API changes, and behavioral changes

---

## Phase 10: Types & Interfaces Refactor

**Goal**: Update type definitions to support atomic claim pattern with heartbeat and change streams

> [!IMPORTANT]
> **No Backwards Compatibility Required (Phases 10+)**: The library has not been released yet, so all changes from Phase 10 forward do not need to maintain backwards compatibility with previous implementations. Existing tests should be adjusted to match the new implementation, and new tests should be added for new functionality.

**Independent Test**: TypeScript compilation passes with updated types, existing tests are adjusted to match new types

### Implementation for Phase 10

- [X] T084 [P] Update JobDocument interface in packages/core/src/types.ts to add claimedBy field (scheduler instance ID)
- [X] T085 [P] Update JobDocument interface in packages/core/src/types.ts to add lastHeartbeat field (timestamp)
- [X] T086 [P] Update JobDocument interface in packages/core/src/types.ts to add heartbeatInterval field (milliseconds)
- [X] T087 [P] Update MonqueOptions interface in packages/core/src/types.ts to add schedulerInstanceId option (defaults to UUID)
- [X] T088 [P] Update MonqueOptions interface in packages/core/src/types.ts to add heartbeatInterval option (defaults to 30000ms)
- [X] T089 [P] Update MonqueOptions interface in packages/core/src/types.ts to add lockTimeout to align with heartbeat timing (defaults to 30000ms)
- [X] T091 Add TSDoc comments to all new fields in packages/core/src/types.ts explaining atomic claim pattern
- [X] T092 Run TypeScript compiler to verify types are correct
- [X] T093 Adjust existing tests to use new type definitions, add tests for new fields (claimedBy, lastHeartbeat, etc.). No backwards compatibility needed.

**Checkpoint**: Type system updated for atomic claim pattern

---

## Phase 11: Indexing Migration

**Goal**: Add indexes to support atomic claim pattern and change stream efficiency

**Independent Test**: Index creation succeeds, query performance tests pass with new indexes

### Tests for Phase 11

- [X] T094 [P] Create packages/core/tests/indexes.test.ts with tests for new index creation
- [X] T095 [P] Add tests for query performance with claimedBy+status index in packages/core/tests/indexes.test.ts
- [X] T096 [P] Add tests for heartbeat query performance with lastHeartbeat+status index in packages/core/tests/indexes.test.ts

### Implementation for Phase 11

- [X] T097 Add compound index on {claimedBy: 1, status: 1} in packages/core/src/monque.ts constructor
- [X] T098 Add compound index on {lastHeartbeat: 1, status: 1} in packages/core/src/monque.ts constructor
- [X] T099 Add compound index on {status: 1, nextRunAt: 1, claimedBy: 1} for atomic claim queries in packages/core/src/monque.ts constructor
- [X] T100 Update existing lockedAt index to include heartbeat: {lockedAt: 1, lastHeartbeat: 1, status: 1} in packages/core/src/monque.ts constructor
- [X] T101 Add TSDoc comments explaining index purposes for atomic claim and heartbeat in packages/core/src/monque.ts
- [X] T102 Run tests to verify indexes are created correctly

**Checkpoint**: Database indexes optimized for atomic claim pattern

---

## Phase 12: Worker Refactor - Atomic Claim + Heartbeat

**Goal**: Replace polling with atomic claim pattern using findOneAndUpdate, add heartbeat mechanism for liveness tracking

**Independent Test**: Jobs are claimed atomically (no duplicate processing), heartbeat updates every interval, stale jobs detected by missing heartbeat

### Tests for Phase 12

- [X] T103 [P] Create packages/core/tests/atomic-claim.test.ts with tests for atomic claim using claimedBy field
- [X] T104 [P] Add tests for concurrent claim attempts (multiple instances, verify only one succeeds) in packages/core/tests/atomic-claim.test.ts
- [X] T105 [P] Create packages/core/tests/heartbeat.test.ts with tests for heartbeat updates during job processing
- [X] T106 [P] Add tests for heartbeat interval configuration in packages/core/tests/heartbeat.test.ts
- [X] T107 [P] Add tests for stale job detection using lastHeartbeat in packages/core/tests/heartbeat.test.ts
- [X] T108 [P] Update packages/core/tests/concurrency.test.ts to verify atomic claim respects concurrency limits
- [X] T109 [P] Update packages/core/tests/locking.test.ts to test atomic claim instead of polling-based locking

### Implementation for Phase 12

- [X] T110 Add schedulerInstanceId generation (UUID v4) in packages/core/src/monque.ts constructor
- [X] T111 Refactor atomic job claim in packages/core/src/monque.ts to use claimedBy field instead of lockedAt:
  - Query: {status: 'pending', nextRunAt: {$lte: now}, $or: [{claimedBy: null}, {claimedBy: this.instanceId}]}
  - Update: {$set: {status: 'processing', claimedBy: this.instanceId, lockedAt: now, lastHeartbeat: now}}
- [X] T112 Implement heartbeat mechanism in packages/core/src/monque.ts:
  - Create heartbeat interval that runs every heartbeatInterval (default 30s)
  - Update lastHeartbeat for all jobs where claimedBy matches this instance
  - Query: {claimedBy: this.instanceId, status: 'processing'}
  - Update: {$set: {lastHeartbeat: now}}
- [X] T113 Update stale job detection in packages/core/src/monque.ts to use lastHeartbeat:
  - Query: {status: 'processing', lastHeartbeat: {$lt: now - lockTimeout}}
  - Recovery: {$set: {status: 'pending', claimedBy: null, lockedAt: null}}
- [X] T114 Add cleanup on job completion in packages/core/src/monque.ts:
  - Clear claimedBy and lastHeartbeat when job completes/fails
- [X] T115 Add heartbeat cleanup on stop() in packages/core/src/monque.ts:
  - Clear interval, update all claimed jobs to release claim
- [X] T116 Update concurrency control to use claimedBy count instead of activeJobs tracking
- [X] T117 Add TSDoc comments explaining atomic claim pattern and heartbeat mechanism
- [X] T118 Run tests to verify atomic claim and heartbeat work correctly
- [X] T119 Run integration test SC-006 to verify no duplicate processing with multiple instances

**Checkpoint**: Atomic claim with heartbeat mechanism fully implemented

---

## Phase 13: Change Stream Integration

**Goal**: Replace polling with MongoDB Change Streams for real-time job notifications

**Independent Test**: Jobs trigger via change streams (no polling delay), system gracefully falls back to polling if change streams unavailable

### Tests for Phase 13

- [x] T120 [P] Create packages/core/tests/change-streams.test.ts with tests for change stream initialization
- [x] T121 [P] Add tests for job notification via change stream insert events in packages/core/tests/change-streams.test.ts
- [x] T122 [P] Add tests for job notification via change stream update events (status change) in packages/core/tests/change-streams.test.ts
- [x] T123 [P] Add tests for change stream error handling and reconnection in packages/core/tests/change-streams.test.ts
- [x] T124 [P] Add tests for graceful fallback to polling when change streams fail in packages/core/tests/change-streams.test.ts
- [x] T125 [P] Add tests for change stream cleanup on shutdown in packages/core/tests/change-streams.test.ts
- [x] T126 [P] Update packages/core/tests/enqueue.test.ts to verify instant processing with change streams (no poll delay)

### Implementation for Phase 13

- [x] T127 Add change stream setup in packages/core/src/monque.ts start() method:
  - Change streams are the default mechanism for job notifications
  - Watch for insert and update operations on jobs collection
  - Filter: {$or: [{operationType: 'insert'}, {operationType: 'update', 'updateDescription.updatedFields.status': {$exists: true}}]}
- [x] T128 Implement change stream event handler in packages/core/src/monque.ts:
  - On insert: Trigger immediate claim attempt for new jobs
  - On update to pending: Trigger claim attempt for released jobs
  - Debounce handler to avoid claim storms (100ms window)
- [x] T129 Add change stream error handling in packages/core/src/monque.ts:
  - On error: Log error, emit 'changestream:error' event
  - Auto-reconnect with exponential backoff
  - Fallback to polling if reconnection fails after 3 attempts
- [x] T130 Update start() method to use change streams as primary with polling as backup:
  - Use change streams for real-time job notifications
  - Keep polling as backup (slower interval, e.g., 10s) for resilience
- [x] T131 Add change stream cleanup in stop() method:
  - Close change stream cursor
  - Emit 'changestream:closed' event
- [x] T132 Adjust pollInterval when using change streams (default to 10000ms instead of 1000ms for backup polling)
- [x] T133 Add TSDoc comments explaining change stream pattern and fallback behavior
- [x] T134 Add new events: 'changestream:connected', 'changestream:error', 'changestream:closed', 'changestream:fallback'
- [x] T135 Run tests to verify change stream integration works correctly
- [x] T136 Run performance comparison tests: change stream vs polling latency
- [x] T137 Add integration test for change stream + atomic claim with multiple instances

**Checkpoint**: Change stream integration complete with fallback to polling

---

## Phase 14: Test Utils Export for Testing

**Goal**: Export test utilities from core package for use in tsed package and user testing

**Independent Test**: Test utils can be imported from @monque/core/testing and work correctly

### Implementation for Phase 14

- [X] T138 Create packages/core/src/testing/index.ts to re-export test utilities
- [X] T139 Export test utilities from packages/core/tests/setup/test-utils.ts (setupTestDatabase, cleanupTestDatabase, createTestJob, etc.)
- [X] T140 Update packages/core/tsdown.config.ts to add './testing' export entry
- [X] T141 Update packages/core/package.json to add './testing' to exports field:
  ```json
  {
    "./testing": {
      "import": "./dist/testing/index.mjs",
      "require": "./dist/testing/index.cjs"
    }
  }
  ```
- [X] T142 Add TSDoc comments to exported test utilities explaining usage
- [X] T143 ~~Create packages/core/tests/exports.test.ts to verify './testing' export works~~ Validated via TypeScript compilation
- [X] T144 Update packages/core/README.md to document test utilities export

**Checkpoint**: Test utilities exported and available for external use

---

## Phase 15: Ts.ED Integration Foundations

**Goal**: Prepare Ts.ED package structure with necessary constants, types, and dependencies

**Independent Test**: Package compiles with new types and constants

### Tests for Phase 15

- [X] T145 Create packages/tsed/tests/constants.test.ts to verify MonqueTypes
- [X] T146 Update packages/tsed/tests/decorator.test.ts to setup for DI injection testing using test utils from `@monque/core/testing`

### Implementation for Phase 15

- [X] T149 Update packages/tsed/package.json: move @tsed/* to dev/peerDependencies, remove reflect-metadata (handled by @tsed)
- [X] T150 Create packages/tsed/src/constants/MonqueTypes.ts with `MonqueTypes` enum (JOB = "monque:job")
- [X] T151 Create packages/tsed/src/constants/constants.ts with `MONQUE_METADATA` constant
- [X] T152 Create packages/tsed/src/contracts/JobMethods.ts interface:
  ```typescript
  export interface JobMethods<T = unknown> {
    handle(data: T, job: Job<T>): Promise<void> | void;
  }
  ```
- [X] T153 Update packages/tsed/src/index.ts to export new types and constants
- [X] T154 Run tests to verify foundational setup
- [X] T155 Update packages/tsed/README.md with installation instructions

**Checkpoint**: Foundations laid for robust Ts.ED integration

---

## Phase 16: User Story 7 - Job Decorator & Discovery (Priority: P3)

**Goal**: Implement @Job decorator that registers classes as custom providers for auto-discovery

**Independent Test**: Decorator correctly sets ProviderType and registers with DI container

### Tests for User Story 7

- [ ] T157 [P] [US7] Create packages/tsed/tests/decorators/job.test.ts verifying @Job sets correct `type` (MonqueTypes.JOB) and metadata
- [ ] T158 [P] [US7] Verify @Job uses `registerProvider` or `Injectable` correctly
- [ ] T159 [P] [US7] Test unique token generation for jobs sharing same class name but different queues (if applicable)

### Implementation for User Story 7

- [ ] T160 [US7] Create packages/tsed/src/utils/getJobToken.ts to generate consistent DI tokens (e.g., `monque:job:${name}`)
- [ ] T161 [US7] Implement `@Job(name, options?)` in packages/tsed/src/decorators/job.ts:
  - Use `useDecorators`, `StoreMerge` (from @tsed/core), and `Injectable` (from @tsed/di)
  - Set `type: MonqueTypes.JOB` in `Injectable` options
  - Store metadata (options) via `StoreMerge`
- [ ] T162 [US7] Run tests to verify decorator registration

**Checkpoint**: @Job decorator correctly registers providers in the DI container

---

## Phase 17: User Story 8 - Module & Dispatcher (Priority: P3)

**Goal**: Implement MonqueModule and JobDispatcher to manage job execution within DI contexts

**Independent Test**: Jobs are processed with full dependency injection support; request-scoped services work within job handlers.

### Tests for User Story 8

- [ ] T165 [P] [US8] Create packages/tsed/tests/dispatchers/JobDispatcher.test.ts testing `runInContext` usage (use `JobFactory` from @monque/core/testing)
- [ ] T166 [P] [US8] Create packages/tsed/tests/MonqueModule.test.ts testing `$onInit` discovery of job providers
- [ ] T167 [P] [US8] Integration test: Job handler injecting a service, verifying service is instantiated per job (use `getTestDb`, `waitFor` from @monque/core/testing)

### Implementation for User Story 8

- [ ] T170 [US8] Create packages/tsed/src/dispatchers/JobDispatcher.ts service:
  - Import `InjectorService` and `Monque` core instance
  - Implement `dispatch(provider)`: registers worker with `monque.worker(name, handler)`
  - Implement `handler` wrapper:
    - Create new `DIContext` (request scope)
    - Bind job data to context
    - Execute `provider.instance.handle(data, job)` via `runInContext`
    - Destroy context after execution
- [ ] T171 [US8] Create packages/tsed/src/MonqueModule.ts:
  - Implement `$onInit`: `injector.getProviders(MonqueTypes.JOB).forEach(p => dispatcher.dispatch(p))`
  - Implement `$onDestroy`: call `monque.stop()`
- [ ] T172 [US8] Implement `forRoot` or configuration integration in MonqueModule to accept `MonqueOptions`
- [ ] T177 [US8] Run integration tests (US8) verifying end-to-end DI support in jobs

**Checkpoint**: Full Ts.ED integration with Request Scoping support

---

## Phase 18: Documentation with Starlight

**Goal**: Create comprehensive documentation website using Starlight (Astro framework)

**Independent Test**: Documentation site builds successfully, all pages render correctly, examples work

### Implementation for Phase 18

- [ ] T179 Create packages/docs/ directory structure
- [ ] T180 Initialize Starlight project in packages/docs/:
  ```bash
  npm create astro@latest packages/docs -- --template starlight
  ```
- [ ] T181 Configure packages/docs/astro.config.mjs with Monque branding and navigation
- [ ] T182 Create packages/docs/src/content/docs/index.mdx as documentation home page
- [ ] T183 Create packages/docs/src/content/docs/getting-started/installation.md
- [ ] T184 Create packages/docs/src/content/docs/getting-started/quick-start.md with examples from specs/001-monque-scheduler/quickstart.md
- [ ] T185 Create packages/docs/src/content/docs/core-concepts/jobs.md explaining job lifecycle
- [ ] T186 Create packages/docs/src/content/docs/core-concepts/workers.md explaining worker registration
- [ ] T187 Create packages/docs/src/content/docs/core-concepts/scheduling.md explaining cron scheduling
- [ ] T188 Create packages/docs/src/content/docs/core-concepts/retry.md explaining retry with backoff
- [ ] T189 Create packages/docs/src/content/docs/advanced/atomic-claim.md explaining atomic claim pattern
- [ ] T190 Create packages/docs/src/content/docs/advanced/change-streams.md explaining change stream integration
- [ ] T191 Create packages/docs/src/content/docs/advanced/heartbeat.md explaining heartbeat mechanism
- [ ] T192 Create packages/docs/src/content/docs/integrations/tsed.md with Ts.ED integration guide
- [ ] T193 Create packages/docs/src/content/docs/api/core.md with core API reference
- [ ] T194 Create packages/docs/src/content/docs/api/tsed.md with Ts.ED API reference
- [ ] T195 Create packages/docs/src/content/docs/guides/testing.md with testing guide using exported test utils
- [ ] T196 Create packages/docs/src/content/docs/guides/migration.md for migration from polling to change streams
- [ ] T197 Add code examples to all documentation pages with syntax highlighting
- [ ] T198 Configure packages/docs/package.json with build and dev scripts
- [ ] T199 Add packages/docs to turbo.json pipeline
- [ ] T200 Update root README.md to link to documentation site
- [ ] T201 Add documentation deployment configuration (Vercel/Netlify)
- [ ] T202 Build and verify documentation site locally

**Checkpoint**: Documentation site complete and ready for deployment

---

## Phase 19: TSDoc Comments & Final Polish

**Purpose**: Add comprehensive TSDoc comments, final documentation, and validation

### TSDoc Tasks

- [ ] T203 [P] Add TSDoc comments to all public APIs in packages/core/src/monque.ts (MonquePublicAPI methods, constructor options)
- [ ] T204 [P] Add TSDoc comments to all types in packages/core/src/types.ts (interfaces, type aliases, enums)
- [ ] T205 [P] Add TSDoc comments to all errors in packages/core/src/errors.ts (error classes, constructors, properties)
- [ ] T206 [P] Add TSDoc comments to utility functions in packages/core/src/utils/backoff.ts
- [ ] T207 [P] Add TSDoc comments to utility functions in packages/core/src/utils/cron.ts
- [ ] T208 [P] Add TSDoc comments to all Ts.ED decorators in packages/tsed/src/decorators/job.ts
- [ ] T209 [P] Add TSDoc comments to MonqueModule in packages/tsed/src/module.ts
- [ ] T210 [P] Add TSDoc examples to key methods showing usage patterns

### Finalization Tasks

- [ ] T211 Run biome lint and format on entire codebase
- [ ] T212 Run full test suite with coverage report (target: 100%)
- [ ] T213 Validate quickstart.md scenarios work end-to-end (SC-001: under 5 minutes)
- [ ] T214 Verify unique key deduplication with 1000 concurrent enqueue attempts (SC-002)
- [ ] T215 Create .github/workflows/release.yml with GitHub Actions release pipeline
- [ ] T216 Update root README.md with badges, quick start, and links to documentation site

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately  
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-9)**: All depend on Foundational phase completion (COMPLETED)
  - US1-US3 (P1): Sequential dependency (US2, US3 build on US1's enqueue/worker)
  - US4-US6 (P2): Can start after US1 completion (build on basic processing)
  - Stale Recovery (Phase 9): Can start after US1 completion
- **Types Refactor (Phase 10)**: No dependencies - can start immediately
- **Indexing Migration (Phase 11)**: Depends on Phase 10
- **Worker Refactor (Phase 12)**: Depends on Phase 11
- **Change Streams (Phase 13)**: Depends on Phase 12
- **Test Utils Export (Phase 14)**: No dependencies - can run in parallel with Phases 10-13
- **Ts.ED Integration (Phase 15-17)**: Depends on Phase 14
- **Documentation (Phase 18)**: Depends on Phases 10-13 completion - can run in parallel with Phases 14-17
- **Final Polish (Phase 19)**: Depends on all previous phases

### User Story Dependencies

| Story          | Priority | Depends On                 | Can Start After |
| -------------- | -------- | -------------------------- | --------------- |
| US1            | P1       | Foundational               | T030 (COMPLETE) |
| US2            | P1       | US1 (enqueue method)       | T035 (COMPLETE) |
| US3            | P1       | US1 (job execution)        | T040 (COMPLETE) |
| US4            | P2       | US1 (enqueue, completion)  | T040 (COMPLETE) |
| US5            | P2       | US1 (polling, activeJobs)  | T041 (COMPLETE) |
| US6            | P2       | US1 (event infrastructure) | T040 (COMPLETE) |
| Stale Recovery | -        | US1 (start method)         | T038 (COMPLETE) |
| US7            | P3       | Ts.ED Foundations (Phase 15) | T154          |
| US8            | P3       | US7 (decorator complete)   | T162            |

### Within Each User Story

1. Tests MUST be written and FAIL before implementation
2. Implementation follows test requirements
3. Run tests to verify before moving to next story

### Parallel Opportunities

**Phase 1 (Setup) - COMPLETED:**
- T003, T004, T005 can run in parallel
- T008, T011, T012 can run in parallel (after respective package init)

**Phase 2 (Foundational) - COMPLETED:**
- T016, T017 can run in parallel (different interfaces)
- T019, T020, T021 can run in parallel (different error classes)
- T023 can run in parallel with T022 (different utility files)
- T024, T025, T026 can run in parallel (different test files)

**Phase 10 (Types Refactor):**
- T084-T090 can ALL run in parallel (different type definitions)

**Phase 11 (Indexing Migration):**
- T094, T095, T096 can run in parallel (different test files)
- T097-T100 can run sequentially or together (index creation)

**Phase 12 (Worker Refactor):**
- T103-T109 can ALL run in parallel (different test files)
- Implementation tasks (T110-T119) should run sequentially due to dependencies

**Phase 13 (Change Streams):**
- T120-T126 can ALL run in parallel (different test files)
- Implementation tasks benefit from sequential execution

**Phase 14 (Test Utils Export):**
- T138-T144 can run in some parallel (separate concerns)

**Phase 15 (Ts.ED Foundations):**
- T145-T146 can run in parallel
- T150-T152 can run in parallel

**Phase 18 (Documentation):**
- T179-T202 can MOSTLY run in parallel (different doc pages)
- Initialize project first (T179-T181), then parallelize content creation

**Phase 19 (Final Polish):**
- T203-T210 can ALL run in parallel (different files)
- T211-T216 should run sequentially (validation steps)

---

## Parallel Example: Phase 10 Types Refactor

```bash
# Launch all type updates in parallel:
Task T084: "Update JobDocument interface - add claimedBy field"
Task T085: "Update JobDocument interface - add lastHeartbeat field"
Task T086: "Update JobDocument interface - add heartbeatInterval field"
Task T087: "Update MonqueOptions - add schedulerInstanceId"
Task T088: "Update MonqueOptions - add heartbeatInterval"
Task T089: "Update MonqueOptions - add lockTimeout"
# All can run simultaneously, then verify with T091-T093
```

---

## Implementation Strategy

### Phases 1-9: COMPLETED ✅

The MVP and all P1-P3 user stories have been completed. The system is fully functional with:
- ✅ Job enqueuing and processing
- ✅ Unique key deduplication
- ✅ Retry with exponential backoff
- ✅ Cron scheduling
- ✅ Graceful shutdown
- ✅ Event lifecycle hooks
- ✅ Stale job recovery

### Current Phase: Refactoring to Atomic Claim Pattern

**Goal**: Replace polling-based job claiming with atomic claim pattern using MongoDB Change Streams for real-time notifications

1. **Phase 10: Types & Interfaces** - Update type system for new fields
2. **Phase 11: Indexing Migration** - Add indexes for atomic claim queries
3. **Phase 12: Worker Refactor** - Implement atomic claim + heartbeat mechanism
4. **Phase 13: Change Streams** - Add MongoDB Change Streams for instant job notifications
5. **Phase 14: Test Utils Export** - Make test utilities available for external use
6. **Phase 15: Ts.ED Foundations** - Foundation types and interfaces
7. **Phase 16: Ts.ED Decorators** - Discovery and Metadata
8. **Phase 17: Ts.ED Module & Dispatcher** - DI Context integration
9. **Phase 18: Documentation** - Create comprehensive Starlight documentation site
10. **Phase 19: Final Polish** - TSDoc comments and final validation

### Incremental Delivery (Refactor)

1. Phase 10 → Type system supports atomic claim pattern
2. Phase 11 → Database indexes optimized for new queries
3. Phase 12 → Atomic claim with heartbeat replaces polling locks
4. Phase 13 → Change streams provide instant job notifications
5. Phase 14-17 → Ts.ED integration fully robust and DI-aware
6. Phase 18 → Beautiful Starlight documentation deployed
7. Phase 19 → Production-ready with comprehensive docs

### Parallel Team Strategy (Refactor Phase)

1. **Developer A**: Phases 10-13 (Core refactor - atomic claim + change streams)
2. **Developer B**: Phase 14-17 (Ts.ED integration)
3. **Developer C**: Phase 18 (Starlight documentation)
4. After core refactor complete:
   - **Developer A**: Phase 19 (Checklist & Polish)

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
