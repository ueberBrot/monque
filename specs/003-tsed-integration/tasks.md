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
- [x] T007 [P] Create test utilities helper in packages/tsed/tests/setup/test-utils.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T008 Implement MONQUE Symbol constant in packages/tsed/src/constants/constants.ts
- [x] T009 [P] Implement ProviderTypes provider type constants in packages/tsed/src/constants/monque-types.ts
- [x] T010 [P] Implement MonqueTsedConfig interface with TsED augmentation in packages/tsed/src/config/config.ts
- [x] T011 [P] Implement validateDatabaseConfig function in packages/tsed/src/config/config.ts
- [x] T012 [P] Implement JobStore, JobMetadata, CronMetadata interfaces in packages/tsed/src/decorators/types.ts
- [x] T013 [P] Inherit JobDecoratorOptions from @monque/core WorkerOptions in packages/tsed/src/decorators/types.ts
- [x] T014 [P] Implement getJobToken utility in packages/tsed/src/utils/get-job-token.ts
- [x] T015 Unit test for resolveDatabase in packages/tsed/tests/unit/utils/resolve-database.test.ts

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1+2 - Declarative Job Controllers with DI (Priority: P1) 🎯 MVP

**Goal**: Enable developers to create @JobController classes with @Job methods that participate in Ts.ED DI system

**Independent Test**: Create a class decorated with `@JobController`. Define methods decorated with `@Job`. Inject a service. Verify the methods are invoked when matching jobs are processed.

### Tests for User Stories 1+2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T016 [P] [US1] Unit test for @JobController decorator in packages/tsed/tests/unit/decorators/job-controller.test.ts
- [x] T017 [P] [US1] Unit test for @Job decorator in packages/tsed/tests/unit/decorators/job.test.ts
- [x] T018 [P] [US2] Unit test for MonqueService in packages/tsed/tests/unit/services/monque-service.test.ts
- [x] T019 [P] [US1] Integration test for job registration in packages/tsed/tests/integration/job-registration.test.ts

### Implementation for User Stories 1+2

- [x] T020 [P] [US1] Implement @JobController class decorator in packages/tsed/src/decorators/job-controller.ts
- [x] T021 [P] [US1] Implement @Job method decorator in packages/tsed/src/decorators/job.ts
- [x] T022 [US1] Implement collectJobMetadata utility in packages/tsed/src/utils/collect-job-metadata.ts
- [x] T023 [US2] Implement MonqueService injectable wrapper in packages/tsed/src/services/monque-service.ts
- [x] T024 [US1] Implement MonqueModule with $onInit job registration in packages/tsed/src/monque-module.ts
- [x] T025 [US1] Add duplicate job name validation in MonqueModule.$onInit in packages/tsed/src/monque-module.ts
- [x] T026 [US1] Add startup error handling (connection failure throws) in packages/tsed/src/monque-module.ts
- [x] T027 [US1] Implement MonqueModule.$onDestroy for graceful shutdown in packages/tsed/src/monque-module.ts
- [x] T028 [US1] Integration test for MonqueModule lifecycle in packages/tsed/tests/integration/monque-module.test.ts

**Checkpoint**: At this point, @JobController with @Job and DI injection should be fully functional

---

## Phase 4: User Story 3+5 - Scheduled Cron Jobs with Isolation (Priority: P2)

**Goal**: Enable @Cron decorator for scheduled tasks with isolated DI context per job execution

**Independent Test**: Decorate a method with `@Cron('* * * * *')`. Verify execution. Inject scoped service, verify state isolation between jobs.

### Tests for User Stories 3+5

- [x] T029 [P] [US3] Unit test for @Cron decorator in packages/tsed/tests/unit/decorators/cron.test.ts
- [x] T030 [P] [US3] Integration test for cron job scheduling in packages/tsed/tests/integration/cron-jobs.test.ts

### Implementation for User Stories 3+5

- [x] T031 [US3] Implement @Cron method decorator in packages/tsed/src/decorators/cron.ts
- [x] T032 [US3] Add cron job scheduling to MonqueModule.$onInit in packages/tsed/src/monque-module.ts
- [x] T033 [US5] Implement executeJob with DIContext isolation (runInContext) in packages/tsed/src/monque-module.ts
- [x] T034 [US5] Add job context cleanup in executeJob finally block in packages/tsed/src/monque-module.ts
- [x] T035 [US5] Add DI resolution error handling (mark job failed, log, continue) in packages/tsed/src/monque-module.ts
- [x] T036 [US5] Use Ts.ED native logger for all logging in MonqueModule in packages/tsed/src/monque-module.ts

**Checkpoint**: @Cron decorator and job isolation should be fully functional

---

## Phase 5: User Story 4 - Marketplace Discovery (Priority: P3)

**Goal**: Package follows Ts.ED naming conventions for marketplace visibility

**Independent Test**: Verify package.json name and keywords match Ts.ED requirements

### Implementation for User Story 4

- [x] T037 [US4] Add Ts.ED marketplace keywords to packages/tsed/package.json
- [x] T038 [US4] Add package description mentioning Ts.ED in packages/tsed/package.json
- [x] T039 [US4] Create README.md with Installation, Configuration, API Reference, Testing sections in packages/tsed/README.md

**Checkpoint**: Package is discoverable in Ts.ED marketplace

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Barrel exports, documentation, and final validation

- [x] T040 [P] Create barrel exports for constants in packages/tsed/src/constants/index.ts
- [x] T041 [P] Create barrel exports for contracts in packages/tsed/src/contracts/index.ts
- [x] T042 [P] Create barrel exports for decorators in packages/tsed/src/decorators/index.ts
- [x] T043 [P] Create barrel exports for services in packages/tsed/src/services/index.ts
- [x] T044 [P] Create barrel exports for utils in packages/tsed/src/utils/index.ts
- [x] T045 Create main barrel export (index.ts) with public API in packages/tsed/src/index.ts
- [x] T046 Run build and verify no TypeScript errors
- [x] T047 Run full test suite (unit + integration) and verify all pass
- [x] T048 Validate quickstart.md scenarios work with implementation
- [x] T049 [US4] Sync README content to @monque/docs workspace per Constitution
- [x] T050 Create Ts.ED integration documentation in apps/docs/src/content/docs/integrations/tsed.mdx

---

## Phase 7: CI/CD & Release

**Purpose**: Ensure robust testing and deployment for the new package

- [x] T051 Add granular test scripts to root package.json (unit/integration per package)
- [x] T052 Update CI to optimize test execution (only changed packages in PRs)
- [x] T053 Configure publishConfig in packages/tsed/package.json
- [x] T054 Verify Changesets release workflow handles multi-package publish

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

- All Setup tasks T003-T007 marked [P] can run in parallel
- All Foundational tasks T009-T014 marked [P] can run in parallel
- Phase 3 tests (T016-T019) can run in parallel
- Phase 3 decorator implementations (T020-T021) can run in parallel
- Phase 6 barrel exports (T040-T044) can run in parallel

---

## Parallel Example: Phase 3 (User Stories 1+2)

```bash
# Launch all tests first (TDD):
Task: "Unit test for @JobController decorator" [T016]
Task: "Unit test for @Job decorator" [T017]
Task: "Unit test for MonqueService" [T018]
Task: "Integration test for job registration" [T019]

# After tests fail, launch parallel decorator implementations:
Task: "Implement @JobController class decorator" [T020]
Task: "Implement @Job method decorator" [T021]
```

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US1+US2 combined as they are tightly coupled (DI is essential for controllers)
- US3+US5 combined as isolation is implemented alongside cron execution
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Edge cases (connection failure, duplicate names, DI errors) are covered in T025, T026, T035
