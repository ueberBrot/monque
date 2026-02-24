# Coding Conventions

**Analysis Date:** 2026-02-24

## Naming Patterns

**Files:**
- All source files use **kebab-case**: `job-processor.ts`, `change-stream-handler.ts`, `test-utils.ts`
- Test files: `{source-name}.test.ts` (e.g., `job-processor.test.ts`)
- Type-only files: `types.ts` per module directory
- Barrel files: `index.ts` per module directory
- Factory files: `{entity}.factory.ts` (e.g., `job.factory.ts`)

**Classes:**
- PascalCase: `Monque`, `JobProcessor`, `ChangeStreamHandler`, `MonqueError`
- Service classes match their filename: `job-processor.ts` exports `JobProcessor`
- Error classes end with `Error`: `InvalidCronError`, `ConnectionError`, `ShutdownTimeoutError`

**Functions:**
- camelCase: `calculateBackoff`, `getNextCronDate`, `isCompletedJob`, `collectJobMetadata`
- Type guard functions use `is` prefix: `isJobDocument`, `isCompletedJob`, `isFailedJob`
- Factory helpers use descriptive verbs: `createMockContext`, `getTestDb`, `clearCollection`

**Variables:**
- camelCase for all variables and parameters
- Private class fields use `#` prefix (true private): `#jobScheduler`, `#processor`, `#context`
- Private getters validate initialization before returning: `get #scheduler()` throws if null

**True Constants:**
- UPPER_SNAKE_CASE: `DEFAULT_BASE_INTERVAL`, `MAX_BACKOFF`, `DEFAULT_POLL_INTERVAL`
- Located in dedicated files or at module top-level
- Always `as const` when defining object constants

**`as const` Objects (Enum Replacement):**
- PascalCase object name with UPPER_SNAKE_CASE keys:
  ```typescript
  export const JobStatus = {
  	PENDING: 'pending',
  	PROCESSING: 'processing',
  	COMPLETED: 'completed',
  	FAILED: 'failed',
  	CANCELLED: 'cancelled',
  } as const;
  ```
- Derived union type uses `{Name}Type` suffix:
  ```typescript
  export type JobStatusType = (typeof JobStatus)[keyof typeof JobStatus];
  ```
- Other examples: `CursorDirection`, `SortField` in `packages/core/src/scheduler/helpers.ts`

**Types/Interfaces:**
- PascalCase, no `I` prefix: `MonqueOptions`, `SchedulerContext`, `JobDocument`
- Type-only files named `types.ts` in each module directory
- Prefer `interface` for object shapes, `type` for unions/intersections/mapped types

## Code Style

**Formatting (Biome-enforced via `biome.json`):**
- **Indentation**: Tabs (width 2)
- **Quotes**: Single quotes for strings
- **Semicolons**: Always required
- **Line width**: 100 characters
- **Trailing commas**: All (including function parameters)
- **Quote style**: Single for JS/TS, double for JSX attributes
- **Config**: `biome.json` at repo root

**Linting (Biome-enforced):**
- Base: `recommended` rules enabled
- `noUnusedImports`: error
- `noUnusedVariables`: error
- `useLiteralKeys`: off (required for `noPropertyAccessFromIndexSignature`)
- `useNodeAssertStrict`: off
- Organize imports: enabled with blank line groups

**Run commands:**
```bash
bun run lint          # Check only (no fixes)
bun run check         # Fix lint + format issues
bun run format        # Format only
```

## Import Organization

**Order (Biome-enforced with blank line separators):**
1. URL imports (if any)
2. Built-ins (`node:events`, `node:crypto`) + external packages (`mongodb`, `zod`, `cron-parser`)
3. *(blank line)*
4. Internal path aliases (`@/jobs`, `@/scheduler/services/types.js`, `@tests/factories`)
5. *(blank line)*
6. Relative imports (`./types.js`, `../helpers.js`)

**Example from `packages/core/src/scheduler/monque.ts`:**
```typescript
import { EventEmitter } from 'node:events';
import { type Db, type MongoClient, ObjectId } from 'mongodb';

import type { JobEventMap } from '@/events/types.js';
import { type JobDocument, type JobInput, JobStatus } from '@/jobs';
import type { SchedulerContext } from '@/scheduler/services/types.js';

import { ChangeStreamHandler } from './services/change-stream-handler.js';
import { JobManager } from './services/job-manager.js';
```

**Path Aliases (configured in `tsconfig.json`):**
- `@/*` maps to `./src/*` — used WITHOUT `.js` extension: `from '@/jobs'`
- `@tests/*` maps to `./tests/*` — test-only alias
- `@test-utils/*` maps to `./tests/setup/*` — test-only alias

**Relative imports:**
- Always include `.js` extension: `from './types.js'`, `from '../helpers.js'`
- This is required for ESM compatibility with `verbatimModuleSyntax`

**Type imports:**
- Use `import type { ... }` for type-only imports (enforced by `verbatimModuleSyntax`)
- Mixed re-exports use inline `type` keyword: `export { type Job, JobStatus }`
- Never import a type without the `type` keyword if it's only used as a type

## TypeScript Strictness

**Config:** `packages/core/tsconfig.json`, `packages/tsed/tsconfig.json`

**Target:** ESNext (both `target` and `lib`)
**Module:** ESNext with `bundler` moduleResolution
**Strict mode:** Enabled, plus these additional flags:

| Flag | Effect |
|------|--------|
| `noUncheckedIndexedAccess` | Index signatures return `T \| undefined` |
| `exactOptionalPropertyTypes` | `undefined` must be explicit in optional props |
| `noImplicitOverride` | `override` keyword required on overridden methods |
| `noPropertyAccessFromIndexSignature` | Must use bracket notation for index sigs |
| `noUnusedLocals` | Error on unused local variables |
| `noUnusedParameters` | Error on unused function parameters |
| `verbatimModuleSyntax` | Forces `import type` for type-only imports |

**Enforced rules:**
- **No `any`**: Use `unknown` with type guards. Generic defaults: `<T = unknown>`.
- **No non-null assertions** (`!`): Use optional chaining (`?.`) or type guards instead.
- **No enums**: Use `as const` objects (see Naming Patterns above).
- **Explicit return types** on all public API methods.
- **Named exports only**: Zero default exports in the entire codebase.

**Type-check command:**
```bash
bun run type-check    # Runs tsc --noEmit across all packages via Turborepo
```

## Error Handling

**Error Hierarchy (defined in `packages/core/src/shared/errors.ts`):**
```
MonqueError (base)
├── InvalidCronError        — Invalid cron expression
├── ConnectionError         — MongoDB connection failures
├── ShutdownTimeoutError    — Graceful shutdown exceeded timeout
├── WorkerRegistrationError — Worker registration issues
├── JobStateError           — Invalid job state transitions
├── InvalidCursorError      — Invalid pagination cursor
└── AggregationTimeoutError — Aggregation pipeline timeout
```

**Base error pattern:**
```typescript
export class MonqueError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MonqueError';
		/* istanbul ignore next -- @preserve */
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}
}
```

**Derived error pattern:**
```typescript
export class InvalidCronError extends MonqueError {
	constructor(expression: string, reason?: string) {
		const message = reason
			? `Invalid cron expression "${expression}": ${reason}`
			: `Invalid cron expression: "${expression}"`;
		super(message);
		this.name = 'InvalidCronError';
	}
}
```

**Usage patterns across the codebase:**
- **Guard-style early throws** for validation (check preconditions, throw immediately)
- **Try/catch with re-wrapping** at service boundaries (catch generic errors, throw domain errors)
- **Catch-and-emit** for background operations: errors emitted via `ctx.emit('error', error)` on polling loops, heartbeats
- **Catch-and-ignore** for shutdown cleanup paths (best-effort cleanup)
- **Error normalization**: `const err = error instanceof Error ? error : new Error(String(error))`

**Initialization guard pattern (used in `packages/core/src/scheduler/monque.ts`):**
```typescript
get #scheduler(): JobScheduler {
	if (!this.#jobScheduler) {
		throw new MonqueError('Monque not initialized. Call initialize() first.');
	}
	return this.#jobScheduler;
}
```

## Barrel File Exports

**Pattern:** Every module directory has an `index.ts` that re-exports its public API.

**Module-level barrels:**
- `packages/core/src/jobs/index.ts` — re-exports types, guards, status constants
- `packages/core/src/events/index.ts` — re-exports event type map
- `packages/core/src/shared/index.ts` — re-exports errors and utils
- `packages/core/src/scheduler/index.ts` — re-exports Monque class and options type

**Root public API (`packages/core/src/index.ts`):**
- Single public entrypoint for the entire package
- Grouped by category with section comments:
  ```typescript
  // Core
  export { Monque } from '@/scheduler/index.js';
  export type { MonqueOptions } from '@/scheduler/index.js';

  // Jobs
  export { JobStatus, isCompletedJob, isFailedJob, isJobDocument } from '@/jobs/index.js';
  export type { JobDocument, JobInput, JobStatusType, ... } from '@/jobs/index.js';

  // Events
  export type { JobEventMap } from '@/events/index.js';

  // Errors
  export { MonqueError, InvalidCronError, ConnectionError, ... } from '@/shared/index.js';
  ```

**Rules:**
- Use `export type { ... }` for pure type re-exports
- Mixed exports use inline `type`: `export { type Job, JobStatus }`
- Internal services are NOT exported from the public API (marked `@internal` in TSDoc)
- Never use default exports anywhere

## TSDoc Conventions

**Public API methods have full TSDoc blocks with:**
- Summary description
- `@param` for each parameter with description
- `@returns` description
- `@throws` listing possible errors
- `@example` with runnable code snippets

**Example from `packages/core/src/scheduler/monque.ts`:**
```typescript
/**
 * Enqueue a one-time job for immediate or delayed processing.
 *
 * @param name - Name identifying the job type (must match a registered worker)
 * @param data - Payload passed to the worker function
 * @param options - Optional scheduling configuration
 * @returns The created job document
 * @throws {MonqueError} If the scheduler is not initialized
 *
 * @example
 * ```typescript
 * const job = await monque.enqueue('send-email', {
 *   to: 'user@example.com',
 *   subject: 'Welcome!',
 * });
 * ```
 */
```

**Internal services use `@internal` tag:**
```typescript
/**
 * Handles job scheduling operations.
 * @internal
 */
export class JobScheduler { ... }
```

**When to add TSDoc:**
- All public API methods and classes (exported from `src/index.ts`)
- All exported types and interfaces
- Complex internal functions where behavior isn't obvious
- NOT needed on simple private helpers, test code, or obvious one-liners

## Build & Distribution

**Build tool:** `tsdown` (configured in each package's `package.json`)

**Dual CJS/ESM output:**
- Builds to `dist/` directory
- Generates `.mjs` (ESM), `.cjs` (CommonJS), `.d.mts`, `.d.cts` (type declarations)
- Package `exports` map in `package.json`:
  ```json
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  }
  ```
- Build command: `bun run build` (runs via Turborepo across all packages)

**Unused export detection:**
- Tool: Knip (`knip.json` at repo root)
- Command: `bun run check:unused`
- Configured to recognize Turborepo workspaces and ignore test patterns

## Git Hooks (Lefthook)

**Pre-commit (`lefthook.yml`):**
1. `type-check` — Runs `bun run type-check` (tsc --noEmit)
2. `biome-check` — Runs `biome check --write` on staged `*.ts` files (auto-fixes formatting/lint)
3. `lockfile` — Runs `bun run check:lockfile` to verify lockfile integrity

**All hooks run in parallel** for speed. Staged files are passed via `{staged_files}` glob.

## Module Design Patterns

**Service pattern (used throughout `packages/core/src/scheduler/services/`):**
- Each service receives `SchedulerContext` via constructor (manual DI)
- Services are stateless except for the shared context
- Services are created lazily in `Monque.initialize()`
- Services accessed through private getters that throw if not initialized

**Context interface (`packages/core/src/scheduler/services/types.ts`):**
```typescript
export interface SchedulerContext {
	collection: Collection<JobDocument>;
	options: Required<MonqueOptions>;
	emit: <E extends keyof JobEventMap>(event: E, ...args: JobEventMap[E]) => boolean;
	registerWorker: (name: string, handler: WorkerHandler, options?: WorkerOptions) => void;
	getWorker: (name: string) => RegisteredWorker | undefined;
}
```

**Ts.ED decorator pattern (`packages/tsed/src/`):**
- Decorators: `@JobController(namespace)`, `@Job(name)`, `@Cron(pattern)`
- Metadata stored via `Store.from(target).set(MONQUE_KEY, ...)`
- Collected at bootstrap via `collectJobMetadata()` which reads stored metadata
- Integration with Ts.ED DI container via `MonqueModule`

---

*Convention analysis: 2026-02-24*
