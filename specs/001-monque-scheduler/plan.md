# Implementation Plan: Monque Job Scheduler Library

**Branch**: `001-monque-scheduler` | **Date**: 2025-12-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-monque-scheduler/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement a TypeScript monorepo containing two packages: `@monque/core` (a MongoDB-backed job scheduler with atomic locking, exponential backoff, cron scheduling, stale job recovery via heartbeats/zombie takeover, real-time processing via Change Streams, and event-driven observability) and `@monque/tsed` (Ts.ED framework integration via decorators and DI). The core uses native MongoDB driver for atomic operations, extends EventEmitter for lifecycle events, and provides custom error classes for proper error handling.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22+  
**Primary Dependencies**: mongodb ^6.0.0 (native driver), cron-parser, @tsed/common, @tsed/di  
**Storage**: MongoDB 4.0+ (required for atomic findAndModify operations and Change Streams)  
**Testing**: Vitest with UI and coverage, targeting 100% coverage  
**Target Platform**: Node.js server runtime (ESM + CJS dual output)  
**Project Type**: Monorepo (Turborepo with Bun workspaces)  
**Performance Goals**: Sub-second job pickup latency (Change Streams + 1s default polling interval)  
**Constraints**: Default 5 concurrent jobs per worker, 30s graceful shutdown timeout, 90s heartbeat tolerance, 16MB max job data (MongoDB document limit)  
**Scale/Scope**: Single namespace per database, multiple scheduler instances supported with atomic locking, stale job recovery on startup (configurable)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle                                    | Status | Evidence                                                                                               |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| **I. Code Quality - Type Safety First**      | ✅ PASS | All code strictly typed, `unknown` over `any`, interfaces for object shapes, custom error classes      |
| **I. Code Quality - Interfaces Over Types**  | ✅ PASS | `Job<T>`, `MonquePublicAPI`, `MonqueEventMap`, `MonqueOptions`, `WorkerOptions` interfaces defined    |
| **I. Code Quality - 100% Test Coverage**     | ✅ PASS | Spec requires happy path, edge cases, error handling, race conditions, backoff tests                   |
| **I. Code Quality - No Enums**               | ✅ PASS | `JobStatus` uses `as const` pattern                                                                    |
| **II. Architecture - Event-Driven Design**   | ✅ PASS | `Monque` extends `EventEmitter`, emits job:start/complete/fail/error                                   |
| **II. Architecture - Native Driver Usage**   | ✅ PASS | Core uses native MongoDB driver, not ORMs                                                              |
| **II. Architecture - Graceful Degradation**  | ✅ PASS | `stop()` method with configurable timeout                                                              |
| **II. Architecture - Atomic Operations**     | ✅ PASS | `findOneAndUpdate` for job locking                                                                     |
| **III. Development - Monorepo Structure**    | ✅ PASS | Turborepo + Bun workspaces, packages/* structure                                                       |
| **III. Development - Consistent Tooling**    | ✅ PASS | Biome for linting/formatting across all packages                                                       |
| **III. Development - Semantic Versioning**   | ✅ PASS | Changesets for release management                                                                      |
| **IV. API Design - Simplicity**              | ✅ PASS | Simple `now()`, `enqueue()`, `schedule()`, `worker()` API                                              |
| **IV. API Design - Framework Agnostic Core** | ✅ PASS | `@monque/core` has no framework dependencies                                                           |
| **IV. API Design - Framework Integrations**  | ✅ PASS | `@monque/tsed` as separate package                                                                     |
| **V. Resilience - Exponential Backoff**      | ✅ PASS | Formula: `now + (2^failCount × baseRetryInterval)`, configurable via options                           |
| **V. Resilience - Graceful Shutdown**        | ✅ PASS | Configurable timeout, waits for in-progress jobs, emits job:error with ShutdownTimeoutError on timeout |
| **V. Resilience - Idempotency**              | ✅ PASS | `uniqueKey` option prevents duplicates                                                                 |
| **V. Resilience - Observability**            | ✅ PASS | All lifecycle events emitted                                                                           |
| **V. Resilience - Stale Job Recovery**       | ✅ PASS | `recoverStaleJobs` option (default: true), lockTimeout for detecting stale jobs                        |

**Gate Result**: ✅ ALL PRINCIPLES SATISFIED

### Post-Design Re-check (Phase 1)

| Principle                 | Status | Post-Design Evidence                                                                                                   |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Type Safety**           | ✅ PASS | `Job<T>` with generic payload, `JobStatus` as const, all options typed, custom error classes                          |
| **Interfaces Over Types** | ✅ PASS | `Job`, `EnqueueOptions`, `MonqueOptions`, `MonqueEventMap`, `WorkerOptions`, `JobDecoratorOptions` |
| **100% Coverage Plan**    | ✅ PASS | Test files for all components: locking, backoff, shutdown, enqueue, worker, errors, stale recovery                     |
| **Event-Driven**          | ✅ PASS | `MonqueEventMap` defines typed events for all lifecycle states including shutdown timeout                              |
| **Native Driver**         | ✅ PASS | Only `mongodb` ^6.0.0 as core dependency, no ORM                                                                       |
| **API Simplicity**        | ✅ PASS | 4 main methods: `now()`, `enqueue()`, `schedule()`, `worker()` + `start()`, `stop()`, `isHealthy()`                    |
| **JSDoc Documentation**   | ✅ PASS | All interfaces documented with examples in contracts                                                                   |
| **Markdown Docs**         | ✅ PASS | `packages/docs/` for portable developer documentation                                                                  |
| **Error Handling**        | ✅ PASS | Custom error classes: `MonqueError`, `InvalidCronError`, `ConnectionError`, `ShutdownTimeoutError`                     |

**Post-Design Gate**: ✅ DESIGN COMPLIANT

## Project Structure

### Documentation (this feature)

```text
specs/001-monque-scheduler/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── job-schema.ts    # TypeScript interface definitions
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
/
├── package.json              # Root workspace configuration
├── turbo.json                # Turborepo pipeline configuration
├── biome.json                # Linting and formatting rules
├── docker-compose.yml        # Local MongoDB service
├── .changeset/               # Changesets configuration
│   └── config.json
├── .github/
│   └── workflows/
│       └── release.yml       # GitHub Actions release pipeline
└── packages/
    ├── core/                 # @monque/core package
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── tsdown.config.ts
    │   ├── src/
    │   │   ├── index.ts      # Public exports
    │   │   ├── monque.ts     # Main Monque class implementing MonquePublicAPI
    │   │   ├── types.ts      # Type definitions (Job, MonqueOptions, etc.)
    │   │   ├── errors.ts     # Custom error classes (MonqueError, InvalidCronError, etc.)
    │   │   └── utils/
    │   │       ├── backoff.ts    # Exponential backoff calculation
    │   │       └── cron.ts       # Cron expression parsing and validation
    │   └── tests/
    │       ├── monque.test.ts
    │       ├── enqueue.test.ts
    │       ├── worker.test.ts
    │       ├── locking.test.ts
    │       ├── backoff.test.ts
    │       ├── shutdown.test.ts
    │       ├── errors.test.ts
    │       └── stale-recovery.test.ts
    ├── tsed/                 # @monque/tsed package
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── tsdown.config.ts
    │   ├── src/
    │   │   ├── index.ts      # Public exports
    │   │   ├── module.ts     # MonqueModule
    │   │   └── decorators/
    │   │       └── job.ts    # @Job decorator
    │   └── tests/
    │       ├── module.test.ts
    │       └── decorator.test.ts
    └── docs/                 # Developer documentation (markdown)
        ├── package.json      # Minimal package for workspace inclusion
        ├── README.md         # Documentation index
        ├── getting-started/
        │   ├── installation.md
        │   ├── quickstart.md
        │   └── configuration.md
        ├── guides/
        │   ├── job-scheduling.md
        │   ├── error-handling.md
        │   ├── graceful-shutdown.md
        │   └── tsed-integration.md
        ├── api/
        │   ├── monque-class.md
        │   ├── job-interface.md
        │   ├── events.md
        │   └── decorators.md
        └── examples/
            ├── basic-usage.md
            ├── unique-jobs.md
            ├── recurring-jobs.md
            └── error-retry.md
```

**Structure Decision**: Monorepo structure with two packages under `packages/`. This aligns with Constitution Principle III (Monorepo Structure) and enables clear package boundaries between framework-agnostic core and framework-specific integrations.

## Implementation Details

### Configuration Defaults (from spec)

| Option               | Default           | Description                                     |
| -------------------- | ----------------- | ----------------------------------------------- |
| `collectionName`     | `'monque_jobs'`   | MongoDB collection for storing jobs             |
| `pollInterval`       | `1000` (1s)       | Interval between polling for new jobs           |
| `maxRetries`         | `10`              | Maximum retry attempts before permanent failure |
| `baseInterval`       | `1000` (1s)       | Base interval for exponential backoff           |
| `shutdownTimeout`    | `30000` (30s)     | Timeout for graceful shutdown                   |
| `defaultConcurrency` | `5`               | Concurrent jobs per worker                      |
| `lockTimeout`        | `1800000` (30min) | Time before processing job is considered stale  |
| `recoverStaleJobs`   | `true`            | Whether to recover stale jobs on startup        |

### Error Classes (from contracts)

| Class                  | Purpose                    | Use Case                                    |
| ---------------------- | -------------------------- | ------------------------------------------- |
| `MonqueError`          | Base error class           | Catch-all for Monque-related errors         |
| `InvalidCronError`     | Invalid cron expression    | Thrown from `schedule()` with invalid cron  |
| `ConnectionError`      | Database connection issues | Thrown when DB operations fail              |
| `ShutdownTimeoutError` | Shutdown timeout           | Emitted via job:error when stop() times out |

### Event Payloads (from contracts)

| Event          | Payload                                           | When Emitted                                |
| -------------- | ------------------------------------------------- | ------------------------------------------- |
| `job:start`    | `Job`                                            | Job begins processing                       |
| `job:complete` | `{ job: Job, duration: number }`                 | Job finishes successfully                   |
| `job:fail`     | `{ job: Job, error: Error, willRetry: boolean }` | Job fails (may retry)                       |
| `job:error`    | `{ error: Error, job?: Job }`                    | Unexpected error including shutdown timeout |

### MongoDB Indexes (required)

```typescript
// Compound index for job polling - status + nextRunAt for efficient queries
{ status: 1, nextRunAt: 1 }

// Unique index for deduplication - sparse to allow null uniqueKey
{ uniqueKey: 1 }, { unique: true, sparse: true }

// Index for stale job recovery - lockedAt for timeout queries  
{ lockedAt: 1, status: 1 }
```

### Key Behaviors (from spec edge cases)

- **Duplicate Prevention**: Jobs with same `uniqueKey` in pending/processing state are not duplicated; completed jobs allow new enqueue
- **Stale Recovery**: On startup, jobs with `status: 'processing'` and `lockedAt` older than `lockTimeout` are reset to pending (if `recoverStaleJobs: true`)
- **Worker Registration**: Workers can be registered before or after `start()`; attempting to re-register the same name throws `WorkerRegistrationError` (unless `replace: true` option is provided)
- **Shutdown Timeout**: When `stop()` times out, emits `job:error` with `ShutdownTimeoutError` containing incomplete jobs list
- **Clock Drift**: All timestamp comparisons use MongoDB server time via `$$NOW` or server-side `$currentDate`

## Complexity Tracking

> No violations identified. All design choices align with Constitution principles.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| N/A       | N/A        | N/A                                  |
