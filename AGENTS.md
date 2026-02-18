# Agent Guidelines for Monque

This repository is a TypeScript monorepo using **Bun**, **Turborepo**, and **Biome**.
You are an expert software engineer working in this environment.

## 1. Core Principles
- **Be Extremely Concise**: Sacrifice grammar for brevity. Output code and essential explanations only.
- **Safety First**: Never commit secrets. verify all changes with tests.
- **Modern Standards**: Use modern TypeScript (ESNext).

## 2. Commands

All commands use `bun`. Never use `npm`, `yarn`, or `pnpm`.

| Task              | Command                         |
| ----------------- | ------------------------------- |
| Install           | `bun install`                   |
| Build             | `bun run build` (uses `tsdown`) |
| Clean             | `bun run clean`                 |
| Lint (check only) | `bun run lint`                  |
| Fix lint + format | `bun run check`                 |
| Format only       | `bun run format`                |
| Type-check        | `bun run type-check`            |
| All tests         | `bun run test`                  |
| Unit tests        | `bun run test:unit`             |
| Integration tests | `bun run test:integration`      |
| Dev mode (watch)  | `bun run test:dev`              |
| Unused exports    | `bun run check:unused` (knip)   |

### Running a Single Test

Run from the **package directory**, not the repo root:

```bash
cd packages/core
bun run test src/scheduler/services/job-processor.test.ts

# Unit only:
bun run test:unit tests/unit/backoff.test.ts
```

Filter a specific package from root:

```bash
bun run test:core        # all @monque/core tests
bun run test:unit:core   # unit only for core
```

### Pre-commit Hooks (Lefthook)

Runs automatically: `type-check` + `biome check --write` on staged files.

## 3. File Structure

```
monque/
├── packages/
│   ├── core/           # @monque/core - Main scheduler logic
│   │   ├── src/
│   │   │   ├── scheduler/      # Monque class + internal services
│   │   │   ├── jobs/           # Job types, guards
│   │   │   ├── events/         # Event type maps
│   │   │   ├── workers/        # Worker types
│   │   │   ├── shared/         # Errors, utils (backoff, cron)
│   │   │   └── index.ts        # Public API barrel
│   │   └── tests/
│   │       ├── unit/           # Pure logic tests (no DB)
│   │       ├── integration/    # Full flow with Testcontainers
│   │       ├── factories/      # fishery factories + faker
│   │       └── setup/          # Test utils, global setup
│   └── tsed/           # @monque/tsed - Ts.ED DI integration
├── apps/docs/          # Documentation site (Astro)
├── specs/              # Specifications
└── biome.json          # Linter/formatter config
```

## 4. Code Style

### Formatting (Biome-enforced)

- **Indentation**: Tabs (width 2)
- **Quotes**: Single quotes
- **Semicolons**: Always
- **Line width**: 100 characters

### Naming Conventions

| Element                | Style                         | Example                                        |
| ---------------------- | ----------------------------- | ---------------------------------------------- |
| Files                  | kebab-case                    | `job-processor.ts`, `change-stream-handler.ts` |
| Classes                | PascalCase                    | `Monque`, `JobProcessor`, `MonqueError`        |
| Functions              | camelCase                     | `calculateBackoff`, `getNextCronDate`          |
| True constants         | UPPER_SNAKE_CASE              | `DEFAULT_BASE_INTERVAL`, `MAX_BACKOFF`         |
| `as const` objects     | PascalCase (UPPER_SNAKE keys) | `JobStatus.PENDING`                            |
| Types/Interfaces       | PascalCase, no `I` prefix     | `MonqueOptions`, `SchedulerContext`            |
| Union types from const | `{Name}Type` suffix           | `JobStatusType` from `JobStatus`               |

### Imports

Biome auto-sorts imports into these groups (separated by blank lines):

1. URL imports
2. Built-ins (`node:url`, `bun:test`) + external packages (`mongodb`, `zod`)
3. *(blank line)*
4. Internal aliases (`@/utils`, `@tests/factories`)
5. *(blank line)*
6. Relative imports (`./types.js`)

Rules:
- `import type { ... }` for type-only imports (enforced by `verbatimModuleSyntax`)
- Mixed: `export { type Job, JobStatus }` with inline `type` keyword
- Relative imports use `.js` extensions (`from './types.js'`)
- Path alias imports do NOT use extensions (`from '@/jobs'`)

### TypeScript Strictness

Strict mode with these extra flags enabled:
- `noUncheckedIndexedAccess` - Index signatures return `T | undefined`
- `exactOptionalPropertyTypes` - `undefined` must be explicit in optional props
- `noImplicitOverride` - `override` keyword required
- `noPropertyAccessFromIndexSignature` - Must use bracket notation for index sigs
- `noUnusedLocals` / `noUnusedParameters`

Rules:
- **No `any`**. Use `unknown` with type guards. Generic defaults: `<T = unknown>`.
- **No non-null assertions** (`!`). Use optional chaining or type guards.
- **No enums**. Use `as const` objects:
  ```typescript
  export const JobStatus = { PENDING: 'pending', PROCESSING: 'processing' } as const;
  export type JobStatusType = (typeof JobStatus)[keyof typeof JobStatus];
  ```
- **Explicit return types** on all public API methods.
- **Named exports only**. Zero default exports in the entire codebase.

### Error Handling

Custom error hierarchy - all extend `MonqueError`:
```
MonqueError
├── InvalidCronError
├── ConnectionError
├── ShutdownTimeoutError
├── WorkerRegistrationError
├── JobStateError
├── InvalidCursorError
└── AggregationTimeoutError
```

Patterns:
- Guard-style early throws for validation
- Try/catch with re-wrapping at service boundaries
- Catch-and-emit for background operations (polling, heartbeats)
- Catch-and-ignore for shutdown cleanup paths
- Error normalization: `const err = error instanceof Error ? error : new Error(String(error))`

### Exports & Barrel Files

- Every directory has an `index.ts` barrel re-exporting its public API
- Root `src/index.ts` is the single public entrypoint, grouped by category with comments
- Use `export type { ... }` for pure type re-exports
- Never use default exports

## 5. Architecture

### Core Package

- **Monque class**: Facade extending typed `EventEmitter` (type-safe `emit`/`on`/`once`/`off`)
- **Internal services**: `JobScheduler`, `JobManager`, `JobQueryService`, `JobProcessor`, `ChangeStreamHandler`
- All services receive a shared `SchedulerContext` interface (manual constructor injection)
- **Lazy init**: Services null-initialized, created in `initialize()`, private getters throw if accessed before init

### Database (MongoDB Native Driver)

- **NO Mongoose**. Native `mongodb` driver only.
- **Atomic locking**: `findOneAndUpdate` mandatory for picking up jobs
- **Idempotency**: `upsert: true` with `$setOnInsert` on `{ name, uniqueKey }`
- **Backoff**: Exponential `min(2^failCount * base, MAX)`, reset status to `pending`

### Ts.ED Package

- Decorator-based: `@JobController(namespace)`, `@Job(name)`, `@Cron(pattern)`
- Metadata stored via `Store.from(target).set(MONQUE, ...)`, collected by `collectJobMetadata()`

## 6. Testing

Framework: **Vitest** with `globals: true` (no need to import `describe`/`it`/`expect`).

### Test Organization

- Tests in `tests/` directory (NOT colocated with source)
- `tests/unit/` - Mock DB with `vi.spyOn`, test logic isolation (5s timeout)
- `tests/integration/` - MongoDB via Testcontainers, full flows (30s timeout)
- `tests/factories/` - `fishery` factories with `@faker-js/faker`
- `tests/setup/` - `global-setup.ts`, `seed.ts`, `test-utils.ts`

### Path Aliases in Tests

- `@/` -> `./src`
- `@tests/` -> `./tests`
- `@test-utils/` -> `./tests/setup`

### Test Utilities

- `createMockContext()` - Full `SchedulerContext` with `vi.fn()` stubs
- `JobFactory` with helpers: `.pending()`, `.processing()`, `.completed()`, `.failed()`
- `getTestDb()`, `cleanupTestDb()`, `clearCollection()`, `uniqueCollectionName()`
- `waitFor()`, `stopMonqueInstances()`, `triggerJobImmediately()`, `findJobByQuery()`

### Required Scenarios

Always test: Happy Path, Idempotency, Resilience (backoff, race conditions).

## 7. Workflow Checklist

1. **Read** related source files before editing
2. **Plan** changes if complex
3. **Implement** following all style rules above
4. **Test** - add/update tests covering changes
5. **Verify** - run `bun run check` and `bun run test:unit` before finishing
