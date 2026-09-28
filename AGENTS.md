# Agent Guidelines for Monque

This repository is a TypeScript monorepo using **Bun** and **Vite+** (Vite Task, Oxfmt, Oxlint, Vitest, and package builds).
You are an expert software engineer working in this environment.

## Agent skills

### Issue tracker

Issues, specs, and Wayfinder maps are tracked in GitHub Issues for `ueberBrot/monque`.
See `docs/agents/issue-tracker.md` for tracker commands and Wayfinding operations.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### Reviewing uncommitted work

When `code-review` reviews work before a commit, compare the working tree against the
merge-base with the requested base: `git diff "$(git merge-base <base> HEAD)"`.
Also read relevant untracked files from `git ls-files --others --exclude-standard`.
The skill's `<base>...HEAD` comparison covers committed changes only; an empty commit
diff does not mean there is no work to review. Use the user's request as the spec when
it describes the work without a separate ticket or spec file.

## 1. Core Principles

- **Be Extremely Concise**: Sacrifice grammar for brevity. Output code and essential explanations only.
- **Safety First**: Never commit secrets. verify all changes with tests, type-check, lint and format.
- **Modern Standards**: Use modern TypeScript (ESNext).

## 2. Commands

Use `vp` as the primary CLI. It selects Bun from `package.json` and Node from `.node-version`. Install with `vp install`; run workflows with `vp run`. Without the global CLI, use `bun x vp` after installing dependencies with Bun. Root scripts provide shared workspace workflows; package-specific commands use `vp run @monque/package#task`.

| Task              | Command                                      |
| ----------------- | -------------------------------------------- |
| Install           | `vp install`                                 |
| Build             | `vp run build` (uses `vp pack` / `vp build`) |
| Clean             | `vp run clean`                               |
| Lint (check only) | `vp lint --deny-warnings`                    |
| Fix lint + format | `vp run check`                               |
| Format only       | `vp fmt`                                     |
| Type-check        | `vp run type-check`                          |
| All tests         | `vp run test`                                |
| Unit tests        | `vp run test:unit`                           |
| Integration tests | `vp run test:integration`                    |
| Dev mode (watch)  | `vp run @monque/core#test:watch`             |
| Unused exports    | `vp run check:unused` (knip)                 |

### Running a Single Test

Run from the **package directory**, not the repo root:

```bash
cd packages/core
vp run test tests/unit/services/job-processor.test.ts

# Unit only:
vp run test:unit tests/unit/backoff.test.ts
```

Filter a specific package from root:

```bash
vp run @monque/core#test        # all @monque/core tests
vp run @monque/core#test:unit   # unit only for core
```

### Pre-commit Hooks (Vite+)

The `.vite-hooks/pre-commit` hook runs workspace type checks and `vp staged`. Staged files use `vp check --fix`; manifest changes also verify the frozen Bun lockfile.

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
└── vite.config.ts      # Shared Oxfmt, Oxlint, tests, and staged checks
```

## 4. Code Style

### Formatting (Oxfmt defaults)

- **Indentation**: 2 spaces
- **Quotes**: Double quotes
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

Oxfmt handles import sorting and group separation using its native configuration. Imports use these groups (separated by blank lines):

1. URL imports
2. Built-ins (`node:url`, `bun:test`) + external packages (`mongodb`, `zod`)
3. _(blank line)_
4. Internal aliases (`@/utils`, `@tests/factories`, `@test-utils/seed`)
5. _(blank line)_
6. Relative imports (`./types.js`)

Workspace tasks and package builds live in each package's `vite.config.ts`. Task names must not duplicate `package.json` scripts. Root lint/format policy applies to every package. Use `vp run -r <task>` across the workspace or `vp run --filter @monque/core <task>` for one package.

Oxlint uses its default correctness rules plus native React checks. The `@shadcn/lint` unknown-class rule applies only to dashboard and dashboard-dev source, excluding `components/ui` and generated routes. Run `vp lint --deny-warnings` to include these checks; use `vp run type-check` for TypeScript checking.

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
  export const JobStatus = { PENDING: "pending", PROCESSING: "processing" } as const;
  export type JobStatusType = (typeof JobStatus)[keyof typeof JobStatus];
  ```
- **Explicit return types** on all public API methods.
- **Named exports only**. Configuration and plugin entrypoints may default-export the object required by their tool.

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
- Application/library code uses named exports; configuration entrypoints may default-export.

## 5. Architecture

### Core Package

- **Monque class**: Facade extending typed `EventEmitter` (type-safe `emit`/`on`/`once`/`off`)
- **Internal services**: `JobIntake`, `JobManager`, `JobQueryService`, `JobProcessor`, `ChangeStreamHandler`
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

Framework: **Vitest via Vite+** (`vite-plus/test` imports; `vite-plus` configuration) with `globals: true` (no need to import `describe`/`it`/`expect`).

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
5. **Verify** - run `vp run check` and `vp run test:unit` before finishing
