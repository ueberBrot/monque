# Implementation Plan: Monque Job Scheduler Library

**Branch**: `001-monque-scheduler` | **Date**: 2025-12-16 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-monque-scheduler/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement a TypeScript monorepo containing two packages: `@monque/core` (a MongoDB-backed job scheduler with atomic locking, exponential backoff, cron scheduling, and event-driven observability) and `@monque/tsed` (Ts.ED framework integration via decorators and DI). The core uses native MongoDB driver for atomic operations and extends EventEmitter for lifecycle events.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 22+  
**Primary Dependencies**: mongodb (native driver), cron-parser, @tsed/common, @tsed/di  
**Storage**: MongoDB 4.0+ (required for atomic findAndModify operations)  
**Testing**: Vitest with UI and coverage, targeting 100% coverage  
**Target Platform**: Node.js server runtime (ESM + CJS dual output)  
**Project Type**: Monorepo (Turborepo with Bun workspaces)  
**Performance Goals**: Sub-second job pickup latency (1s default polling interval)  
**Constraints**: Default 5 concurrent jobs per worker, 30s graceful shutdown timeout, 16MB max job data (MongoDB document limit)  
**Scale/Scope**: Single namespace per database, multiple scheduler instances supported with atomic locking

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle                                    | Status | Evidence                                                                             |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| **I. Code Quality - Type Safety First**      | ✅ PASS | All code strictly typed, `unknown` over `any`, interfaces for object shapes          |
| **I. Code Quality - Interfaces Over Types**  | ✅ PASS | `IJob<T>` interface defined for job schema                                           |
| **I. Code Quality - 100% Test Coverage**     | ✅ PASS | Spec requires happy path, edge cases, error handling, race conditions, backoff tests |
| **I. Code Quality - No Enums**               | ✅ PASS | `JobStatus` uses `as const` pattern                                                  |
| **II. Architecture - Event-Driven Design**   | ✅ PASS | `Monque` extends `EventEmitter`, emits job:start/complete/fail/error                 |
| **II. Architecture - Native Driver Usage**   | ✅ PASS | Core uses native MongoDB driver, not ORMs                                            |
| **II. Architecture - Graceful Degradation**  | ✅ PASS | `stop()` method with configurable timeout                                            |
| **II. Architecture - Atomic Operations**     | ✅ PASS | `findOneAndUpdate` for job locking                                                   |
| **III. Development - Monorepo Structure**    | ✅ PASS | Turborepo + Bun workspaces, packages/* structure                                     |
| **III. Development - Consistent Tooling**    | ✅ PASS | Biome for linting/formatting across all packages                                     |
| **III. Development - Semantic Versioning**   | ✅ PASS | Changesets for release management                                                    |
| **IV. API Design - Simplicity**              | ✅ PASS | Simple `enqueue()`, `schedule()`, `worker()` API                                     |
| **IV. API Design - Framework Agnostic Core** | ✅ PASS | `@monque/core` has no framework dependencies                                         |
| **IV. API Design - Framework Integrations**  | ✅ PASS | `@monque/tsed` as separate package                                                   |
| **V. Resilience - Exponential Backoff**      | ✅ PASS | Formula: `now + (2^failCount × baseInterval)`                                        |
| **V. Resilience - Graceful Shutdown**        | ✅ PASS | Configurable timeout, waits for in-progress jobs                                     |
| **V. Resilience - Idempotency**              | ✅ PASS | `uniqueKey` option prevents duplicates                                               |
| **V. Resilience - Observability**            | ✅ PASS | All lifecycle events emitted                                                         |

**Gate Result**: ✅ ALL PRINCIPLES SATISFIED

### Post-Design Re-check (Phase 1)

| Principle                 | Status | Post-Design Evidence                                                        |
| ------------------------- | ------ | --------------------------------------------------------------------------- |
| **Type Safety**           | ✅ PASS | `IJob<T>` with generic payload, `JobStatus` as const, all options typed     |
| **Interfaces Over Types** | ✅ PASS | `IJob`, `EnqueueOptions`, `MonqueOptions`, `JobDecoratorOptions` interfaces |
| **100% Coverage Plan**    | ✅ PASS | Test files for all components: locking, backoff, shutdown, enqueue, worker  |
| **Event-Driven**          | ✅ PASS | `MonqueEventMap` defines typed events for all lifecycle states              |
| **Native Driver**         | ✅ PASS | Only `mongodb` as core dependency, no ORM                                   |
| **API Simplicity**        | ✅ PASS | 3 main methods: `enqueue()`, `schedule()`, `worker()`                       |
| **JSDoc Documentation**   | ✅ PASS | All interfaces documented with examples in contracts                        |

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
    │   │   ├── monque.ts     # Main Monque class
    │   │   ├── types.ts      # Type definitions
    │   │   └── utils/
    │   │       └── backoff.ts
    │   └── tests/
    │       ├── monque.test.ts
    │       ├── enqueue.test.ts
    │       ├── worker.test.ts
    │       ├── locking.test.ts
    │       ├── backoff.test.ts
    │       └── shutdown.test.ts
    └── tsed/                 # @monque/tsed package
        ├── package.json
        ├── tsconfig.json
        ├── tsdown.config.ts
        ├── src/
        │   ├── index.ts      # Public exports
        │   ├── module.ts     # MonqueModule
        │   └── decorators/
        │       └── job.ts    # @Job decorator
        └── tests/
            ├── module.test.ts
            └── decorator.test.ts
```

**Structure Decision**: Monorepo structure with two packages under `packages/`. This aligns with Constitution Principle III (Monorepo Structure) and enables clear package boundaries between framework-agnostic core and framework-specific integrations.

## Complexity Tracking

> No violations identified. All design choices align with Constitution principles.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| N/A       | N/A        | N/A                                  |
