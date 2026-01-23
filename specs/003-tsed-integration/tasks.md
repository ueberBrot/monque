# Tasks: Ts.ED Integration (@monque/tsed)

**Input**: Design documents from `/specs/003-tsed-integration/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Tests**: Included per plan.md test structure (unit + integration tests)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Monorepo package**: `packages/tsed/src/`, `packages/tsed/tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Package initialization, build tooling, and test infrastructure

- [x] T001 Create package directory structure per plan.md in packages/tsed/
- [x] T002 Initialize package.json with dependencies (@tsed/core, @tsed/di, @tsed/schema ^8.0.0, @monque/core workspace:*) and devDependencies (@tsed/platform-http ^8.0.0 for PlatformTest, @tsed/testcontainers-mongo, vitest) in packages/tsed/package.json
- [x] T003 [P] Configure TypeScript with strict mode in packages/tsed/tsconfig.json
- [x] T004 [P] Configure tsdown build tool in packages/tsed/tsdown.config.ts
- [x] T005 [P] Configure Vitest with @tsed/testcontainers-mongo/vitest/setup in packages/tsed/vitest.config.ts
- [x] T006 [P] Configure Vitest for unit tests only in packages/tsed/vitest.unit.config.ts
- [x] T009 [P] Create test utilities helper in packages/tsed/tests/setup/test-utils.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T010 Implement MONQUE Symbol constant in packages/tsed/src/constants/constants.ts
- [x] T011 [P] Implement ProviderTypes provider type constants in packages/tsed/src/constants/monque-types.ts
- [x] T012 [P] Implement MonqueTsedConfig interface with TsED augmentation in packages/tsed/src/config/config.ts
- [x] T013 [P] Implement validateDatabaseConfig function in packages/tsed/src/config/config.ts
- [x] T014 [P] Implement WorkerStore, WorkerMetadata, CronMetadata interfaces in packages/tsed/src/contracts/worker-store.ts
- [x] T015 [P] Implement WorkerMethods handler interface in packages/tsed/src/contracts/worker-methods.ts
- [x] T015b [P] Inherit WorkerDecoratorOptions from @monque/core WorkerOptions in packages/tsed/src/contracts/worker-store.ts
- [x] T016 [P] Implement buildJobName utility function in packages/tsed/src/utils/build-job-name.ts
- [x] T017 [P] Implement resolveDatabase multi-strategy utility in packages/tsed/src/utils/resolve-database.ts
- [x] T018 [P] Implement getWorkerToken utility in packages/tsed/src/utils/get-worker-token.ts
- [x] T019 Unit test for resolveDatabase in packages/tsed/tests/unit/utils/resolve-database.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1+2 - Declarative Job Controllers with DI (Priority: P1) 🎯 MVP

**Goal**: Enable developers to create @WorkerController classes with @Worker methods that participate in Ts.ED DI system

**Independent Test**: Create a class decorated with `@WorkerController`. Define methods decorated with `@Worker`. Inject a service. Verify the methods are invoked when matching jobs are processed.

### Tests for User Stories 1+2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T020 [P] [US1] Unit test for @WorkerController decorator in packages/tsed/tests/unit/decorators/worker-controller.test.ts
- [ ] T021 [P] [US1] Unit test for @Worker decorator in packages/tsed/tests/unit/decorators/worker.test.ts
- [ ] T022 [P] [US2] Unit test for MonqueService in packages/tsed/tests/unit/services/monque-service.test.ts
- [ ] T023 [P] [US1] Integration test for worker registration in packages/tsed/tests/integration/worker-registration.test.ts

### Implementation for User Stories 1+2

- [ ] T024 [P] [US1] Implement @WorkerController class decorator in packages/tsed/src/decorators/worker-controller.ts
- [ ] T025 [P] [US1] Implement @Worker method decorator in packages/tsed/src/decorators/worker.ts
- [ ] T026 [P] [US2] Implement @InjectMonque property decorator in packages/tsed/src/decorators/inject-monque.ts
- [ ] T027 [US1] Implement collectWorkerMetadata utility in packages/tsed/src/utils/collect-worker-metadata.ts
- [ ] T028 [US2] Implement MonqueService injectable wrapper in packages/tsed/src/services/monque-service.ts
- [ ] T029 [US1] Implement MonqueModule with $onInit worker registration in packages/tsed/src/monque-module.ts
- [ ] T030 [US1] Add duplicate job name validation in MonqueModule.$onInit in packages/tsed/src/monque-module.ts
- [ ] T031 [US1] Add startup error handling (connection failure throws) in packages/tsed/src/monque-module.ts
- [ ] T032 [US1] Implement MonqueModule.$onDestroy for graceful shutdown in packages/tsed/src/monque-module.ts
- [ ] T033 [US1] Integration test for MonqueModule lifecycle in packages/tsed/tests/integration/monque-module.test.ts

**Checkpoint**: At this point, @WorkerController with @Worker and DI injection should be fully functional

---

## Phase 4: User Story 3+5 - Scheduled Cron Jobs with Isolation (Priority: P2)

**Goal**: Enable @Cron decorator for scheduled tasks with isolated DI context per job execution

**Independent Test**: Decorate a method with `@Cron('* * * * *')`. Verify execution. Inject scoped service, verify state isolation between jobs.

### Tests for User Stories 3+5

- [ ] T034 [P] [US3] Unit test for @Cron decorator in packages/tsed/tests/unit/decorators/cron.test.ts
- [ ] T035 [P] [US3] Integration test for cron job scheduling in packages/tsed/tests/integration/cron-jobs.test.ts

### Implementation for User Stories 3+5

- [ ] T036 [US3] Implement @Cron method decorator in packages/tsed/src/decorators/cron.ts
- [ ] T037 [US3] Add cron job scheduling to MonqueModule.$onInit in packages/tsed/src/monque-module.ts
- [ ] T038 [US5] Implement executeJob with DIContext isolation (runInContext) in packages/tsed/src/monque-module.ts
- [ ] T039 [US5] Add job context cleanup in executeJob finally block in packages/tsed/src/monque-module.ts
- [ ] T040 [US5] Add DI resolution error handling (mark job failed, log, continue) in packages/tsed/src/monque-module.ts
- [ ] T041 [US5] Use Ts.ED native logger for all logging in MonqueModule in packages/tsed/src/monque-module.ts

**Checkpoint**: @Cron decorator and job isolation should be fully functional

---

## Phase 5: User Story 4 - Marketplace Discovery (Priority: P3)

**Goal**: Package follows Ts.ED naming conventions for marketplace visibility

**Independent Test**: Verify package.json name and keywords match Ts.ED requirements

### Implementation for User Story 4

- [ ] T042 [US4] Add Ts.ED marketplace keywords to packages/tsed/package.json
- [ ] T043 [US4] Add package description mentioning Ts.ED in packages/tsed/package.json
- [ ] T044 [US4] Create README.md with Installation, Configuration, API Reference, Testing sections in packages/tsed/README.md

**Checkpoint**: Package is discoverable in Ts.ED marketplace

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Barrel exports, documentation, and final validation

- [x] T045 [P] Create barrel exports for constants in packages/tsed/src/constants/index.ts
- [x] T046 [P] Create barrel exports for contracts in packages/tsed/src/contracts/index.ts
- [ ] T047 [P] Create barrel exports for decorators in packages/tsed/src/decorators/index.ts
- [ ] T048 [P] Create barrel exports for services in packages/tsed/src/services/index.ts
- [x] T049 [P] Create barrel exports for utils in packages/tsed/src/utils/index.ts
- [ ] T050 Create main barrel export (index.ts) with public API in packages/tsed/src/index.ts
- [ ] T051 Run build and verify no TypeScript errors
- [ ] T052 Run full test suite (unit + integration) and verify all pass
- [ ] T053 Validate quickstart.md scenarios work with implementation
- [ ] T054 [US4] Sync README content to @monque/docs workspace per Constitution
- [ ] T055 Verify NFR-001 (<10ms overhead) via simple benchmark test
- [ ] T055b [P] Implement performance benchmark script for NFR-001 (1k no-op jobs) in packages/tsed/scripts/benchmark.ts
- [ ] T056 Create Ts.ED integration documentation in apps/docs/src/content/docs/integrations/tsed.mdx

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on T001, T002 completion - BLOCKS all user stories
- **User Stories 1+2 (Phase 3)**: Depends on Foundational phase completion
- **User Stories 3+5 (Phase 4)**: Depends on Phase 3 completion (builds on MonqueModule)
- **User Story 4 (Phase 5)**: Can run in parallel with Phase 3 or 4
- **Polish (Phase 6)**: Depends on all previous phases

### User Story Dependencies

- **User Story 1+2 (P1)**: Can start after Foundational - Core MVP
- **User Story 3+5 (P2)**: Depends on US1+2 (extends MonqueModule)
- **User Story 4 (P3)**: Independent - only needs package.json from Setup

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Constants/interfaces before decorators
- Decorators before services
- Services before MonqueModule
- Unit tests before integration tests

### Parallel Opportunities

- All Setup tasks T003-T009 marked [P] can run in parallel
- All Foundational tasks T011-T018 marked [P] can run in parallel
- Phase 3 tests (T020-T023) can run in parallel
- Phase 3 decorator implementations (T024-T026) can run in parallel
- Phase 6 barrel exports (T045-T049) can run in parallel

---

## Parallel Example: Phase 3 (User Stories 1+2)

```bash
# Launch all tests first (TDD):
Task: "Unit test for @WorkerController decorator" [T020]
Task: "Unit test for @Worker decorator" [T021]
Task: "Unit test for MonqueService" [T022]
Task: "Integration test for worker registration" [T023]

# After tests fail, launch parallel decorator implementations:
Task: "Implement @WorkerController class decorator" [T024]
Task: "Implement @Worker method decorator" [T025]
Task: "Implement @InjectMonque property decorator" [T026]
```

---

## Implementation Strategy

### MVP First (User Stories 1+2 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Stories 1+2
4. **STOP and VALIDATE**: Test controller/worker/DI independently
5. Deploy/demo if ready - developers can use @WorkerController + @Worker + DI

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Stories 1+2 → Test independently → **MVP Ready!**
3. Add User Stories 3+5 → Test independently → Cron + Isolation
4. Add User Story 4 → Test independently → Marketplace visible
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Stories 1+2 (core decorators + DI)
   - Developer B: User Story 4 (package.json + README) - can start immediately
3. After Phase 3:
   - Developer A: User Stories 3+5 (cron + isolation)
   - Developer B: Polish tasks

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US1+US2 combined as they are tightly coupled (DI is essential for controllers)
- US3+US5 combined as isolation is implemented alongside cron execution
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Edge cases (connection failure, duplicate names, DI errors) are covered in T030, T031, T040
