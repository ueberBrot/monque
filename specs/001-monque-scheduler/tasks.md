# Tasks: Monque Job Scheduler Library

**Input**: Design documents from `/specs/001-monque-scheduler/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: Included - spec.md specifies 100% test coverage requirement (Constitution Principle I)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

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

- [ ] T001 Run `bun init` at repo root, configure workspaces in package.json for packages/*
- [ ] T002 Run `bunx turbo init` to scaffold turbo.json, configure build/test/lint pipelines
- [ ] T003 [P] Run `bunx @biomejs/biome init` to scaffold biome.json with recommended rules
- [ ] T004 [P] Create docker-compose.yml with MongoDB service for local development
- [ ] T005 [P] Run `bunx changeset init` to scaffold .changeset/ directory and config.json
- [ ] T006 Run `cd packages/core && bun init` then add mongodb, cron-parser dependencies
- [ ] T007 Run `bunx tsdown --init` in packages/core/ to scaffold tsdown.config.ts (ESM + CJS dual output)
- [ ] T008 [P] Create packages/core/tsconfig.json with strict TypeScript configuration (extend root if present)
- [ ] T009 Run `cd packages/tsed && bun init` then add @tsed/common, @tsed/di, @monque/core dependencies
- [ ] T010 Run `bunx tsdown --init` in packages/tsed/ to scaffold tsdown.config.ts (ESM + CJS dual output)
- [ ] T011 [P] Create packages/tsed/tsconfig.json with strict TypeScript configuration (extend root if present)
- [ ] T012 [P] Run `cd packages/docs && bun init` for minimal workspace placeholder
- [ ] T013 Run `bunx vitest init` at root, configure workspace and coverage settings targeting 100%
- [ ] T014 Run `bun install` to install all dependencies

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types and infrastructure that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T015 Create packages/core/src/types.ts with JobStatus const, IJob<T> interface, EnqueueOptions, MonqueOptions, JobHandler, MonqueEventMap from contracts/job-schema.ts
- [ ] T016 Create packages/core/src/index.ts with public exports (types, Monque class placeholder)
- [ ] T017 Create packages/core/src/monque.ts with Monque class skeleton extending EventEmitter (constructor accepting Db, options)
- [ ] T018 [P] Create packages/core/src/utils/backoff.ts with calculateBackoff function: `nextRunAt = now + (2^failCount × baseInterval)`
- [ ] T019 [P] Create packages/core/tests/backoff.test.ts with unit tests for backoff calculation (edge cases: 0, 1, max retries)
- [ ] T020 Implement MongoDB collection setup and index creation in Monque constructor (status+nextRunAt, uniqueKey+status partial)
- [ ] T021 Run tests to verify foundational setup passes

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Enqueue and Process One-off Jobs (Priority: P1) 🎯 MVP

**Goal**: Enqueue one-off jobs via `enqueue()` and `now()`, process with registered workers

**Independent Test**: Enqueue a job with data, verify registered worker receives and processes it, job status changes to "completed"

### Tests for User Story 1

> **Write tests FIRST, ensure they FAIL before implementation**

- [ ] T022 [P] [US1] Create packages/core/tests/enqueue.test.ts with tests for enqueue() method (basic enqueue, runAt option, data integrity)
- [ ] T023 [P] [US1] Create packages/core/tests/worker.test.ts with tests for worker() registration and job processing
- [ ] T024 [P] [US1] Create packages/core/tests/locking.test.ts with tests for atomic job locking (concurrent workers, no duplicate processing)

### Implementation for User Story 1

- [ ] T025 [US1] Implement enqueue<T>(name, data, options) method in packages/core/src/monque.ts (insert job document with status=pending, nextRunAt)
- [ ] T026 [US1] Implement now<T>(name, data) method in packages/core/src/monque.ts (syntactic sugar calling enqueue with runAt=now)
- [ ] T027 [US1] Implement worker(name, handler, options?) method in packages/core/src/monque.ts (store handler in workers Map)
- [ ] T028 [US1] Implement start() method with polling loop in packages/core/src/monque.ts (setInterval based on pollInterval option)
- [ ] T029 [US1] Implement atomic job locking using findOneAndUpdate in packages/core/src/monque.ts (status=pending, nextRunAt<=now → status=processing, lockedAt=now)
- [ ] T030 [US1] Implement job execution and completion logic in packages/core/src/monque.ts (call handler, set status=completed on success)
- [ ] T031 [US1] Implement concurrency control in packages/core/src/monque.ts (track activeJobs per worker, respect defaultConcurrency)
- [ ] T032 [US1] Add placeholder comments for job:start event emission (implemented in US6) in packages/core/src/monque.ts
- [ ] T033 [US1] Add placeholder comments for job:complete event emission (implemented in US6) in packages/core/src/monque.ts
- [ ] T034 [US1] Run tests for US1 to verify all pass

**Checkpoint**: User Story 1 complete - basic job enqueueing and processing works

---

## Phase 4: User Story 2 - Prevent Duplicate Jobs with Unique Keys (Priority: P1)

**Goal**: Use uniqueKey option to prevent duplicate pending/processing jobs

**Independent Test**: Enqueue multiple jobs with same uniqueKey, verify only one exists; verify completed jobs don't block new ones

### Tests for User Story 2

- [ ] T035 [P] [US2] Add tests in packages/core/tests/enqueue.test.ts for uniqueKey deduplication (pending blocks, processing blocks, completed allows)

### Implementation for User Story 2

- [ ] T036 [US2] Implement uniqueKey handling in enqueue() in packages/core/src/monque.ts (upsert with $setOnInsert pattern for pending/processing status check)
- [ ] T037 [US2] Add partial index enforcement for uniqueKey in Monque constructor in packages/core/src/monque.ts
- [ ] T038 [US2] Run tests for US2 to verify deduplication works correctly

**Checkpoint**: User Story 2 complete - duplicate prevention works independently

---

## Phase 5: User Story 3 - Retry Failed Jobs with Exponential Backoff (Priority: P1)

**Goal**: Failed jobs automatically retry with exponential backoff; permanent failure after max retries

**Independent Test**: Create job that fails, verify rescheduled with increasing delays; verify permanent failure after max retries

### Tests for User Story 3

- [ ] T039 [P] [US3] Create packages/core/tests/retry.test.ts with tests for retry logic (backoff timing, failCount increment, failReason storage, max retries → failed status)

### Implementation for User Story 3

- [ ] T040 [US3] Implement job failure handling in packages/core/src/monque.ts (catch handler errors, increment failCount, store failReason)
- [ ] T041 [US3] Integrate backoff calculation in failure handling in packages/core/src/monque.ts (use utils/backoff.ts to set nextRunAt, reset status to pending)
- [ ] T042 [US3] Implement max retry check in packages/core/src/monque.ts (if failCount >= maxRetries, set status=failed permanently)
- [ ] T043 [US3] Emit job:fail event with error and willRetry flag in packages/core/src/monque.ts
- [ ] T044 [US3] Run tests for US3 to verify retry and backoff behavior

**Checkpoint**: User Story 3 complete - retry with backoff works independently

---

## Phase 6: User Story 4 - Schedule Recurring Jobs with Cron (Priority: P2)

**Goal**: Schedule recurring jobs with cron expressions; auto-reschedule after completion

**Independent Test**: Schedule job with cron expression, verify runs at expected times and re-schedules itself

### Tests for User Story 4

- [ ] T045 [P] [US4] Create packages/core/tests/schedule.test.ts with tests for schedule() method (cron parsing, nextRunAt calculation, re-scheduling after completion, invalid cron rejection)

### Implementation for User Story 4

- [ ] T046 [US4] Implement schedule(cronExpression, name, data) method in packages/core/src/monque.ts (validate cron with cron-parser, calculate nextRunAt, store repeatInterval)
- [ ] T047 [US4] Implement re-scheduling logic in job completion handler in packages/core/src/monque.ts (if repeatInterval exists, calculate next run and create new pending job)
- [ ] T048 [US4] Add cron validation with helpful error messages in packages/core/src/monque.ts (catch cron-parser errors, throw descriptive error)
- [ ] T049 [US4] Run tests for US4 to verify recurring job scheduling works

**Checkpoint**: User Story 4 complete - cron scheduling works independently

---

## Phase 7: User Story 5 - Graceful Shutdown (Priority: P2)

**Goal**: stop() method stops polling, waits for in-progress jobs, respects timeout

**Independent Test**: Call stop() while jobs processing, verify all complete before promise resolves; verify timeout behavior

### Tests for User Story 5

- [ ] T050 [P] [US5] Create packages/core/tests/shutdown.test.ts with tests for stop() method (stops polling, waits for jobs, timeout behavior, warning for incomplete)

### Implementation for User Story 5

- [ ] T051 [US5] Implement stop() method in packages/core/src/monque.ts (clear polling interval, set stopping flag)
- [ ] T052 [US5] Implement in-progress job tracking and waiting in packages/core/src/monque.ts (Promise.all on activeJobs)
- [ ] T053 [US5] Implement shutdown timeout logic in packages/core/src/monque.ts (Promise.race with timeout, emit warning for incomplete jobs)
- [ ] T054 [US5] Run tests for US5 to verify graceful shutdown works

**Checkpoint**: User Story 5 complete - graceful shutdown works independently

---

## Phase 8: User Story 6 - Monitor Job Lifecycle Events (Priority: P2)

**Goal**: Subscribe to job:start, job:complete, job:fail, job:error events for observability

**Independent Test**: Subscribe to all events, verify correct events fire at each lifecycle stage

### Tests for User Story 6

- [ ] T055 [P] [US6] Create packages/core/tests/events.test.ts with tests for all lifecycle events (job:start, job:complete, job:fail, job:error with correct payloads)

### Implementation for User Story 6

- [ ] T056 [US6] Emit job:error event for unexpected errors in packages/core/src/monque.ts (wrap handler calls in try-catch, emit on unexpected errors)
- [ ] T057 [US6] Add typed event emitter helper methods in packages/core/src/monque.ts (override on/emit for type safety with MonqueEventMap)
- [ ] T058 [US6] Run tests for US6 to verify event emission is complete

**Checkpoint**: User Story 6 complete - event monitoring works independently

---

## Phase 9: User Story 7 - Use Decorators for Ts.ED Job Handlers (Priority: P3)

**Goal**: @Job decorator for Ts.ED that auto-registers workers with DI support

**Independent Test**: Create class with @Job decorator, verify auto-registered when module loads with injected dependencies

### Tests for User Story 7

- [ ] T059 [P] [US7] Create packages/tsed/tests/decorator.test.ts with tests for @Job decorator (metadata storage, auto-discovery, DI injection)

### Implementation for User Story 7

- [ ] T060 [US7] Create packages/tsed/src/decorators/job.ts with @Job decorator implementation (store metadata with Reflect, register as provider)
- [ ] T061 [US7] Create packages/tsed/src/constants.ts with JOB_METADATA_KEY symbol
- [ ] T062 [US7] Implement job handler class discovery in packages/tsed/src/module.ts (scan for classes with job metadata on startup)
- [ ] T063 [US7] Implement worker registration from decorated classes in packages/tsed/src/module.ts (retrieve instance from DI, register handler with Monque)
- [ ] T064 [US7] Run tests for US7 to verify decorator-based registration works

**Checkpoint**: User Story 7 complete - Ts.ED decorators work independently

---

## Phase 10: User Story 8 - Configure Ts.ED Module with Different Connection Types (Priority: P3)

**Goal**: MonqueModule.forRoot() accepts Mongoose Connection or native MongoDB Db

**Independent Test**: Configure module with each connection type, verify jobs can be enqueued and processed

### Tests for User Story 8

- [ ] T065 [P] [US8] Create packages/tsed/tests/module.test.ts with tests for MonqueModule configuration (Mongoose connection, native Db, auto-start polling)

### Implementation for User Story 8

- [ ] T066 [US8] Create packages/tsed/src/module.ts with MonqueModule class and forRoot() static method
- [ ] T067 [US8] Implement connection type detection in packages/tsed/src/module.ts (check for Mongoose Connection.db vs native Db)
- [ ] T068 [US8] Register Monque instance as provider in packages/tsed/src/module.ts (create Monque with extracted Db, register in DI container)
- [ ] T069 [US8] Implement OnInit lifecycle hook in packages/tsed/src/module.ts (call monque.start() when application starts)
- [ ] T070 [US8] Create packages/tsed/src/index.ts with public exports (MonqueModule, Job decorator, re-export core types)
- [ ] T071 [US8] Run tests for US8 to verify module configuration works

**Checkpoint**: User Story 8 complete - Ts.ED integration fully functional

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, and final validation

- [ ] T072 [P] Create packages/docs/README.md with documentation index
- [ ] T073 [P] Create packages/docs/getting-started/installation.md with installation instructions from quickstart.md
- [ ] T074 [P] Create packages/docs/getting-started/quickstart.md with basic usage examples from quickstart.md
- [ ] T075 [P] Create packages/docs/getting-started/configuration.md documenting MonqueOptions
- [ ] T076 [P] Create packages/docs/guides/job-scheduling.md covering one-off and cron jobs
- [ ] T077 [P] Create packages/docs/guides/error-handling.md covering retry and backoff
- [ ] T078 [P] Create packages/docs/guides/graceful-shutdown.md documenting stop() behavior
- [ ] T079 [P] Create packages/docs/guides/tsed-integration.md for Ts.ED users
- [ ] T080 [P] Create packages/docs/api/monque-class.md with full API reference
- [ ] T081 [P] Create packages/docs/api/job-interface.md documenting IJob<T>
- [ ] T082 [P] Create packages/docs/api/events.md documenting MonqueEventMap
- [ ] T083 [P] Create packages/docs/api/decorators.md documenting @Job decorator
- [ ] T084 Create .github/workflows/release.yml with GitHub Actions release pipeline
- [ ] T085 Run full test suite with coverage report (target: 100%)
- [ ] T086 Run biome lint and format on entire codebase
- [ ] T087 Validate quickstart.md scenarios work end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-10)**: All depend on Foundational phase completion
  - US1-US3 (P1): Can proceed sequentially (US2, US3 depend on US1's enqueue/worker infrastructure)
  - US4-US6 (P2): Can start after US3 completes (build on retry infrastructure)
  - US7-US8 (P3): Can start after US1 completes (only need basic Monque class)
- **Polish (Phase 11)**: Can start after US6 completes for core docs; after US8 for Ts.ED docs

### User Story Dependencies

| Story | Priority | Depends On                 | Can Start After |
| ----- | -------- | -------------------------- | --------------- |
| US1   | P1       | Foundational               | Phase 2         |
| US2   | P1       | US1 (enqueue method)       | T025            |
| US3   | P1       | US1 (job execution)        | T030            |
| US4   | P2       | US1 (enqueue, completion)  | T030            |
| US5   | P2       | US1 (polling, activeJobs)  | T031            |
| US6   | P2       | US1 (event infrastructure) | T032            |
| US7   | P3       | US1 (worker method)        | T027            |
| US8   | P3       | US7 (decorator, module)    | T063            |

### Within Each User Story

1. Tests MUST be written and FAIL before implementation
2. Implementation follows test requirements
3. Run tests to verify before moving to next story

### Parallel Opportunities

**Phase 1 (all [P] tasks):**
- T003, T004, T005 can run in parallel
- T008, T011, T012 can run in parallel (after respective package init)

**Phase 2:**
- T018, T019 can run in parallel

**Phase 3 (US1):**
- T022, T023, T024 can run in parallel (all tests)

**Phase 11 (Documentation):**
- T072-T083 can ALL run in parallel (different files)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task T022: "Create packages/core/tests/enqueue.test.ts"
Task T023: "Create packages/core/tests/worker.test.ts"
Task T024: "Create packages/core/tests/locking.test.ts"
# Wait for tests to be written, then implement sequentially
```

---

## Implementation Strategy

### MVP First (User Story 1-3 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (basic enqueue/process)
4. Complete Phase 4: User Story 2 (unique keys)
5. Complete Phase 5: User Story 3 (retry/backoff)
6. **STOP and VALIDATE**: Test all P1 stories independently
7. Deploy/demo if ready - this is a functional job queue!

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 → Basic job processing works (minimal MVP)
3. Add US2 → Deduplication works
4. Add US3 → Reliability works (P1 complete!)
5. Add US4 → Cron scheduling works
6. Add US5 → Production-ready shutdown
7. Add US6 → Observability complete (P2 complete!)
8. Add US7 + US8 → Ts.ED integration (P3 complete!)
9. Polish → Production ready

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 → US2 → US3 (P1 core path)
   - Developer B: User Story 7 → US8 (P3 Ts.ED path, after US1 worker method)
3. After P1 complete:
   - Developer A: US4, US5, US6 (P2 features)
   - Developer B: Documentation (Phase 11)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Constitution requires 100% test coverage - tests are mandatory
