# Codebase Structure

**Analysis Date:** 2026-02-24

## Directory Layout

```
monque/
├── packages/
│   ├── core/                      # @monque/core - Main scheduler library
│   │   ├── src/
│   │   │   ├── scheduler/         # Monque facade + internal services
│   │   │   │   ├── services/      # 5 internal services + shared context type
│   │   │   │   ├── monque.ts      # Main Monque class (facade)
│   │   │   │   ├── types.ts       # MonqueOptions
│   │   │   │   ├── helpers.ts     # Query builders, cursor encode/decode
│   │   │   │   └── index.ts       # Barrel
│   │   │   ├── jobs/              # Job types, status, guards
│   │   │   │   ├── types.ts       # Job, PersistedJob, JobStatus, filters, cursors, stats
│   │   │   │   ├── guards.ts      # Type guards (isPendingJob, isPersistedJob, etc.)
│   │   │   │   └── index.ts       # Barrel
│   │   │   ├── events/            # Event type maps
│   │   │   │   ├── types.ts       # MonqueEventMap (13 events)
│   │   │   │   └── index.ts       # Barrel
│   │   │   ├── workers/           # Worker types
│   │   │   │   ├── types.ts       # WorkerOptions, WorkerRegistration
│   │   │   │   └── index.ts       # Barrel
│   │   │   ├── shared/            # Cross-cutting utilities
│   │   │   │   ├── errors.ts      # Error hierarchy (7 classes)
│   │   │   │   ├── utils/         # Backoff, cron helpers
│   │   │   │   │   ├── backoff.ts # calculateBackoff, calculateBackoffDelay
│   │   │   │   │   ├── cron.ts    # getNextCronDate, validateCronExpression
│   │   │   │   │   └── index.ts   # Barrel
│   │   │   │   └── index.ts       # Barrel
│   │   │   └── index.ts           # Public API barrel (single entrypoint)
│   │   ├── tests/
│   │   │   ├── unit/              # Pure logic tests (no DB)
│   │   │   │   ├── services/      # Service-level unit tests
│   │   │   │   └── *.test.ts      # Guards, errors, cursor, backoff, cron tests
│   │   │   ├── integration/       # Full flow with Testcontainers MongoDB
│   │   │   │   └── *.test.ts      # 17 integration test files
│   │   │   ├── factories/         # fishery factories + faker
│   │   │   │   └── job.factory.ts # JobFactory with status helpers
│   │   │   └── setup/             # Test utilities, global setup
│   │   │       ├── global-setup.ts
│   │   │       ├── seed.ts
│   │   │       └── test-utils.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsdown.config.ts       # Build config (dual CJS/ESM)
│   │   └── vitest.config.ts       # Test runner config
│   └── tsed/                      # @monque/tsed - Ts.ED integration
│       ├── src/
│       │   ├── monque-module.ts   # @Module (lifecycle, job discovery, registration)
│       │   ├── config/            # MonqueTsedConfig type + validation
│       │   │   ├── types.ts
│       │   │   └── index.ts
│       │   ├── constants/         # MONQUE symbol, ProviderTypes
│       │   │   ├── constants.ts
│       │   │   ├── types.ts
│       │   │   └── index.ts
│       │   ├── decorators/        # @JobController, @Job, @Cron
│       │   │   ├── job-controller.ts
│       │   │   ├── job.ts
│       │   │   ├── cron.ts
│       │   │   ├── types.ts
│       │   │   └── index.ts
│       │   ├── services/          # MonqueService injectable wrapper
│       │   │   ├── monque-service.ts
│       │   │   └── index.ts
│       │   ├── utils/             # DB resolution, metadata collection
│       │   │   ├── resolve-database.ts
│       │   │   ├── collect-job-metadata.ts
│       │   │   ├── build-job-name.ts
│       │   │   ├── get-job-token.ts
│       │   │   ├── guards.ts
│       │   │   └── index.ts
│       │   └── index.ts           # Public API barrel
│       ├── tests/
│       │   ├── unit/              # Unit tests per module
│       │   │   ├── config/
│       │   │   ├── decorators/
│       │   │   ├── services/
│       │   │   └── utils/
│       │   └── integration/       # Integration tests with Ts.ED
│       │       ├── decorators/
│       │       └── helpers/
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsdown.config.ts
│       └── vitest.config.ts
├── apps/
│   └── docs/                      # @monque/docs - Documentation site
│       ├── src/
│       │   ├── content/docs/      # Starlight documentation pages
│       │   │   ├── getting-started/
│       │   │   ├── core-concepts/
│       │   │   ├── advanced/
│       │   │   ├── integrations/
│       │   │   ├── api/           # TypeDoc generated (core)
│       │   │   └── api-tsed/      # TypeDoc generated (tsed)
│       │   ├── components/
│       │   ├── remark/            # Custom remark plugins
│       │   ├── styles/
│       │   └── assets/
│       ├── public/
│       ├── astro.config.mjs
│       └── package.json
├── scripts/                       # Build/CI scripts
│   ├── validate-api-links.ts      # Validates API doc links
│   └── renovate-generate-changeset.ts
├── .agents/                       # Agent skills config
│   └── skills/
├── .changeset/                    # Changesets for versioning
├── .github/
│   └── workflows/                 # CI pipeline
├── biome.json                     # Linter/formatter (project-wide)
├── knip.json                      # Unused export detection
├── lefthook.yml                   # Git hooks (pre-commit)
├── turbo.json                     # Turborepo task pipeline
├── package.json                   # Root workspace config
├── bun.lock                       # Bun lockfile
└── .nvmrc                         # Node version (22)
```

## Directory Purposes

**`packages/core/src/scheduler/`:**
- Purpose: Core scheduler logic — the main `Monque` class and its internal service decomposition
- Contains: Facade class, 5 services, helpers, types
- Key files:
  - `monque.ts` — Main `Monque` class (1311 lines, facade pattern)
  - `services/job-processor.ts` — Poll loop, atomic claim, execution, retry
  - `services/job-scheduler.ts` — Enqueue, now, schedule operations
  - `services/job-manager.ts` — Cancel, retry, reschedule, delete (single + bulk)
  - `services/job-query.ts` — Query, cursor pagination, stats aggregation
  - `services/change-stream-handler.ts` — Real-time notifications + reconnection
  - `services/types.ts` — `SchedulerContext` and `ResolvedMonqueOptions`
  - `helpers.ts` — `buildSelectorQuery()`, `encodeCursor()`, `decodeCursor()`
  - `types.ts` — `MonqueOptions` interface

**`packages/core/src/jobs/`:**
- Purpose: Job domain types, status constants, and type guards
- Contains: Core type definitions for the entire system
- Key files:
  - `types.ts` — `Job<T>`, `PersistedJob<T>`, `JobStatus`, `EnqueueOptions`, `ScheduleOptions`, `GetJobsFilter`, `JobHandler<T>`, `CursorOptions`, `CursorPage<T>`, `QueueStats`, `BulkOperationResult`, `JobSelector`
  - `guards.ts` — `isPendingJob()`, `isCompletedJob()`, `isFailedJob()`, `isProcessingJob()`, `isCancelledJob()`, `isRecurringJob()`, `isPersistedJob()`, `isValidJobStatus()`

**`packages/core/src/events/`:**
- Purpose: Type-safe event definitions for `Monque` EventEmitter
- Contains: Single `MonqueEventMap` interface with 13 event types
- Key files: `types.ts`

**`packages/core/src/workers/`:**
- Purpose: Worker registration types
- Contains: `WorkerOptions` (public), `WorkerRegistration` (internal)
- Key files: `types.ts`

**`packages/core/src/shared/`:**
- Purpose: Cross-cutting concerns — error hierarchy and utility functions
- Contains: Error classes, backoff logic, cron helpers
- Key files:
  - `errors.ts` — 7 error classes extending `MonqueError`
  - `utils/backoff.ts` — `calculateBackoff()`, `calculateBackoffDelay()`
  - `utils/cron.ts` — `getNextCronDate()`, `validateCronExpression()`

**`packages/tsed/src/`:**
- Purpose: Ts.ED framework integration package
- Contains: Module, service wrapper, decorators, configuration, utilities
- Key files:
  - `monque-module.ts` — `MonqueModule` (`@Module`) — lifecycle, job discovery, registration
  - `services/monque-service.ts` — `MonqueService` (`@Injectable`) — DI-friendly wrapper
  - `decorators/job-controller.ts` — `@JobController(namespace)` class decorator
  - `decorators/job.ts` — `@Job(name)` method decorator
  - `decorators/cron.ts` — `@Cron(pattern)` method decorator
  - `config/types.ts` — `MonqueTsedConfig` (extends `MonqueOptions`)
  - `utils/resolve-database.ts` — Multi-strategy DB resolution (direct/factory/token/mongoose)
  - `utils/collect-job-metadata.ts` — Collects decorator metadata from classes

**`packages/core/tests/`:**
- Purpose: All tests for core package (NOT colocated with source)
- Contains: Unit tests, integration tests, factories, setup utilities
- Key subdirectories:
  - `unit/` — Pure logic tests, mocked DB (5s timeout)
  - `unit/services/` — Service-level unit tests
  - `integration/` — Full MongoDB tests via Testcontainers (30s timeout)
  - `factories/` — `fishery` factories with `@faker-js/faker`
  - `setup/` — `global-setup.ts`, `seed.ts`, `test-utils.ts`

**`packages/tsed/tests/`:**
- Purpose: Tests for tsed package
- Contains: Unit tests organized by module, integration tests with Ts.ED
- Key subdirectories:
  - `unit/config/`, `unit/decorators/`, `unit/services/`, `unit/utils/`
  - `integration/decorators/`, `integration/helpers/`

**`apps/docs/`:**
- Purpose: Documentation website (Astro + Starlight)
- Contains: Content pages, TypeDoc-generated API reference, custom components
- Key subdirectories:
  - `src/content/docs/` — Markdown documentation pages
  - `src/content/docs/api/` — TypeDoc generated for `@monque/core`
  - `src/content/docs/api-tsed/` — TypeDoc generated for `@monque/tsed`

## Key File Locations

**Entry Points:**
- `packages/core/src/index.ts`: Public API barrel for `@monque/core`
- `packages/tsed/src/index.ts`: Public API barrel for `@monque/tsed`
- `packages/core/src/scheduler/monque.ts`: Main `Monque` class implementation

**Configuration:**
- `biome.json`: Linting + formatting (project-wide)
- `turbo.json`: Turborepo pipeline definitions
- `knip.json`: Unused export detection
- `lefthook.yml`: Pre-commit hooks (type-check + biome)
- `packages/core/vitest.config.ts`: Core test configuration
- `packages/tsed/vitest.config.ts`: Ts.ED test configuration
- `packages/core/tsdown.config.ts`: Core build configuration
- `packages/tsed/tsdown.config.ts`: Ts.ED build configuration
- `packages/core/tsconfig.json`: Core TypeScript config
- `packages/tsed/tsconfig.json`: Ts.ED TypeScript config

**Core Logic:**
- `packages/core/src/scheduler/monque.ts`: Facade (init, start, stop, register, delegate)
- `packages/core/src/scheduler/services/job-processor.ts`: Processing engine
- `packages/core/src/scheduler/services/job-scheduler.ts`: Job creation
- `packages/core/src/scheduler/services/job-manager.ts`: Job lifecycle management
- `packages/core/src/scheduler/services/job-query.ts`: Query + pagination + stats
- `packages/core/src/scheduler/services/change-stream-handler.ts`: Real-time notifications
- `packages/core/src/shared/errors.ts`: Error hierarchy

**Testing:**
- `packages/core/tests/setup/test-utils.ts`: Shared test utilities
- `packages/core/tests/setup/global-setup.ts`: Global Vitest setup
- `packages/core/tests/factories/job.factory.ts`: Job factory
- `packages/core/tests/unit/services/`: Service unit tests
- `packages/core/tests/integration/`: Integration tests

## Naming Conventions

**Files:**
- `kebab-case.ts`: All source files (e.g., `job-processor.ts`, `change-stream-handler.ts`)
- `*.test.ts`: Test files (e.g., `job-processor.test.ts`)
- `index.ts`: Barrel re-export files in every directory

**Directories:**
- `kebab-case/`: All directories (e.g., `scheduler/services/`)
- Exception: `unit/`, `integration/`, `factories/`, `setup/` in test directories

**Classes:**
- `PascalCase`: `Monque`, `JobProcessor`, `MonqueModule`, `MonqueService`

**Types/Interfaces:**
- `PascalCase`, no `I` prefix: `MonqueOptions`, `SchedulerContext`, `PersistedJob`
- Union from const: `{Name}Type` suffix (e.g., `JobStatusType` from `JobStatus`)

**Constants:**
- `UPPER_SNAKE_CASE` for true constants: `DEFAULT_BASE_INTERVAL`, `MAX_BACKOFF`
- `PascalCase` for `as const` objects: `JobStatus.PENDING`, `CursorDirection.FORWARD`

## Where to Add New Code

**New Internal Service (core):**
- Implementation: `packages/core/src/scheduler/services/{service-name}.ts`
- Types: Add to `packages/core/src/scheduler/services/types.ts` or create a new types file
- Re-export: Add to `packages/core/src/scheduler/services/index.ts`
- Integration: Wire into `Monque.buildContext()` and `Monque.initialize()` in `packages/core/src/scheduler/monque.ts`
- Tests: `packages/core/tests/unit/services/{service-name}.test.ts`

**New Job Type/Interface (core):**
- Types: `packages/core/src/jobs/types.ts`
- Guards: `packages/core/src/jobs/guards.ts`
- Re-export: `packages/core/src/jobs/index.ts`
- Public export: `packages/core/src/index.ts`
- Tests: `packages/core/tests/unit/guards.test.ts`

**New Error Class (core):**
- Implementation: `packages/core/src/shared/errors.ts` (extend `MonqueError`)
- Re-export: `packages/core/src/shared/index.ts`
- Public export: `packages/core/src/index.ts`
- Tests: `packages/core/tests/unit/errors.test.ts`

**New Utility Function (core):**
- Implementation: `packages/core/src/shared/utils/{utility-name}.ts`
- Re-export: `packages/core/src/shared/utils/index.ts` → `packages/core/src/shared/index.ts`
- Public export (if needed): `packages/core/src/index.ts`
- Tests: `packages/core/tests/unit/{utility-name}.test.ts`

**New Event (core):**
- Add to: `packages/core/src/events/types.ts` (add entry to `MonqueEventMap`)
- Emit from: Relevant service or `Monque` facade
- No barrel change needed (interface is type-only)

**New Decorator (tsed):**
- Implementation: `packages/tsed/src/decorators/{decorator-name}.ts`
- Types: `packages/tsed/src/decorators/types.ts`
- Re-export: `packages/tsed/src/decorators/index.ts` → `packages/tsed/src/index.ts`
- Tests: `packages/tsed/tests/unit/decorators/{decorator-name}.test.ts`

**New Public API Method (core):**
- Add method to: `packages/core/src/scheduler/monque.ts` (delegates to service)
- Service implementation: relevant service in `packages/core/src/scheduler/services/`
- Types: relevant types file
- Public export: `packages/core/src/index.ts` (if new types needed)
- Unit test: `packages/core/tests/unit/services/`
- Integration test: `packages/core/tests/integration/`

**New Documentation Page:**
- Add to: `apps/docs/src/content/docs/{category}/{page-name}.mdx`
- Categories: `getting-started/`, `core-concepts/`, `advanced/`, `integrations/`

## Special Directories

**`dist/` (in each package):**
- Purpose: Build output (dual CJS/ESM via tsdown)
- Generated: Yes (by `bun run build`)
- Committed: No (gitignored)

**`node_modules/`:**
- Purpose: Dependencies
- Generated: Yes (by `bun install`)
- Committed: No (gitignored)

**`.turbo/`:**
- Purpose: Turborepo cache
- Generated: Yes
- Committed: No (gitignored)

**`.changeset/`:**
- Purpose: Pending changesets for version bumps
- Generated: Via `changeset` CLI
- Committed: Yes

**`.agents/skills/`:**
- Purpose: Agent skill definitions for AI tooling
- Generated: No (manually maintained)
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning documents and codebase analysis
- Generated: By GSD workflow
- Committed: Yes

**`apps/docs/src/content/docs/api/` and `api-tsed/`:**
- Purpose: TypeDoc-generated API reference documentation
- Generated: Yes (by TypeDoc during build)
- Committed: Yes (committed for deployment)

## Path Aliases

**Core package (`packages/core/tsconfig.json`):**
- `@/` → `./src` (e.g., `import { Job } from '@/jobs'`)
- `@tests/` → `./tests`
- `@test-utils/` → `./tests/setup`

**Ts.ED package (`packages/tsed/tsconfig.json`):**
- `@/` → `./src` (e.g., `import { MonqueService } from '@/services'`)

**Import rules:**
- Path alias imports do NOT use `.js` extensions: `from '@/jobs'`
- Relative imports DO use `.js` extensions: `from './types.js'`

---

*Structure analysis: 2026-02-24*
