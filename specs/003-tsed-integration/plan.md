# Implementation Plan: Ts.ED Integration

**Branch**: `003-tsed-integration` | **Date**: 2026-01-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-tsed-integration/spec.md`

## Summary

Create a new `@monque/tsed` package that provides a Ts.ED integration for `@monque/core`. The integration follows the patterns established by `@tsed/bullmq` and `@tsed/agenda`, offering decorator-based worker registration (`@WorkerController`, `@Worker`, `@Cron`), native lifecycle integration via `$onInit`/`$onDestroy` hooks, type-safe job definitions, and automatic DI context creation for job isolation.

## Technical Context

**Language/Version**: TypeScript 5.9+, Node.js 22+
**Primary Dependencies**: `@tsed/core` ^8.0.0, `@tsed/di` ^8.0.0, `@tsed/schema` ^8.0.0, `@monque/core` ^1.0.0
**Dev Dependencies**: `@tsed/platform-http` ^8.0.0 (for PlatformTest), `@tsed/testcontainers-mongo`, `vitest`
**Storage**: MongoDB (via `@monque/core`)
**Testing**: Vitest 4.x with PlatformTest + `@tsed/testcontainers-mongo` for integration tests
**Target Platform**: Node.js server environments
**Project Type**: Monorepo package (`packages/tsed/`)
**Performance Goals**: Sub-millisecond decorator overhead. Overhead Benchmark: <10ms diff between raw Monque vs MonqueModule (avg of 1k no-ops).
**Constraints**: Must support all three database resolution strategies (direct Db, factory, DI token), use Ts.ED native logger for all logging
**Scale/Scope**: Expected to handle same throughput as `@monque/core` (thousands of jobs/second)
**Release Strategy**: Standard Monorepo Changesets workflow. Package name: `@monque/tsed`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Code Quality Standards** | PASS | TypeScript strict mode, no `any`, no enums, close to 100% test coverage target |
| **II. Architecture Guidelines** | PASS | Event-driven via @monque/core, native driver usage, graceful degradation via lifecycle hooks |
| **III. Development Workflow** | PASS | Monorepo structure, workspace-aware, consistent tooling |
| **IV. API Design Principles** | PASS | Simple decorator API, extensible options, framework-specific integration package |
| **V. Resilience Patterns** | PASS | Leverages @monque/core's backoff, graceful shutdown, idempotency, observability |
| **VI. Documentation Standards** | PASS | JSDoc on all public APIs, README.md with examples |

**Gate Result**: PASS - No violations detected.

## Project Structure

### Documentation (this feature)

```text
specs/003-tsed-integration/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/tsed/
├── src/
│   ├── index.ts                        # Barrel exports
│   ├── monque-module.ts                # Main module (lifecycle hooks, worker registration)
│   │
│   ├── config/
│   │   └── config.ts                   # MonqueTsedConfig + TsED augmentation
│   │
│   ├── constants/
│   │   ├── monque-types.ts             # Provider types (WORKER_CONTROLLER)
│   │   └── constants.ts                # MONQUE Symbol for Store
│   │
│   ├── contracts/
│   │   ├── index.ts
│   │   ├── worker-methods.ts           # Worker handler interface
│   │   ├── worker-store.ts             # Metadata stored by decorators
│   │
│   ├── decorators/
│   │   ├── index.ts
│   │   ├── worker-controller.ts        # @WorkerController class decorator
│   │   ├── worker.ts                   # @Worker method decorator
│   │   ├── cron.ts                     # @Cron method decorator
│   │   └── inject-monque.ts            # @InjectMonque property decorator
│   │
│   ├── services/
│   │   ├── index.ts
│   │   └── monque-service.ts           # Injectable Monque wrapper
│   │
│   └── utils/
│       ├── get-worker-token.ts         # Token generation
│       ├── resolve-database.ts         # Multi-strategy DB resolution
│       └── collect-worker-metadata.ts  # Collect method decorator metadata
│
├── tests/
│   ├── setup/
│   │   └── test-utils.ts               # Helper functions
│   │
│   ├── unit/                           # Fast tests, no MongoDB
│   │   ├── decorators/
│   │   │   ├── worker-controller.test.ts
│   │   │   ├── worker.test.ts
│   │   │   └── cron.test.ts
│   │   ├── services/
│   │   │   └── monque-service.test.ts
│   │   └── utils/
│   │       └── resolve-database.test.ts
│   │
│   └── integration/                    # Full DI + MongoDB tests
│       ├── monque-module.test.ts
│       ├── worker-registration.test.ts
│       └── cron-jobs.test.ts
│
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── vitest.config.ts                    # Full tests (integration + unit)
├── vitest.unit.config.ts               # Unit tests only
└── README.md
```

**Structure Decision**: Single package in monorepo under `packages/tsed/` following the established pattern from `packages/core/`.

## Complexity Tracking

> No violations detected - this section is empty.

---

## Post-Design Constitution Re-Check

*Completed after Phase 1 design artifacts were generated.*

| Principle | Status | Verification |
|-----------|--------|--------------|
| **I. Code Quality Standards** | PASS | Contracts use `interface` for object shapes, `type` only for unions. `ProviderTypes` uses `as const` pattern (no enums). Test strategy includes unit + integration coverage. |
| **II. Architecture Guidelines** | PASS | Uses @monque/core's event-driven design. MonqueModule implements graceful shutdown via `$onDestroy`. DI context per job ensures isolation. |
| **III. Development Workflow** | PASS | Package at `packages/tsed/` follows monorepo structure. Uses workspace dependencies (`workspace:*`). Same tooling as core (tsdown, vitest). |
| **IV. API Design Principles** | PASS | Simple: `@WorkerController/@Worker` is minimal setup. Extensible: options objects for advanced config. Framework-specific package keeps core agnostic. |
| **V. Resilience Patterns** | PASS | Delegates to @monque/core for backoff, shutdown, idempotency. MonqueModule.$onDestroy calls monque.stop() for graceful shutdown. |
| **VI. Documentation Standards** | PASS | Contracts include JSDoc with `@param`, `@returns`, `@example`. quickstart.md provides usage examples. README.md required in deliverables. |

**Post-Design Gate Result**: PASS - Design is fully compliant with Constitution v1.2.0.
