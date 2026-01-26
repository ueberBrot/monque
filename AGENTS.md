# Agent Guidelines for Monque

This repository is a TypeScript monorepo using **Bun**, **Turborepo**, and **Biome**.
You are an expert software engineer working in this environment.

## 1. Core Principles
- **Be Extremely Concise**: Sacrifice grammar for brevity. Output code and essential explanations only.
- **Safety First**: Never commit secrets. verify all changes with tests.
- **Modern Standards**: Use modern TypeScript (ESNext) and the Native MongoDB driver.

## 2. Environment & Commands
All commands must be run with `bun`.

### Build & Maintenance
- **Install**: `bun install`
- **Build**: `bun run build` (uses `tsdown`)
- **Clean**: `bun run clean`
- **Lint**: `bun run lint` (Check only)
- **Fix Lint/Format**: `bun run check` (Apply safe fixes and format)
- **Format**: `bun run format`

### Testing (Vitest)
- **Run All Tests**: `bun run test`
- **Unit Tests Only**: `bun run test:unit`
- **Integration Tests Only**: `bun run test:integration`
- **Dev Mode**: `bun run test:dev` (Keeps Testcontainers alive for speed)

### Running a Single Test
To run a specific test file, execute the test command from within the package directory:
```bash
# Example: Running a core test
cd packages/core
bun run test src/jobs/MyJob.test.ts
```
*Do not run `vitest` directly from the root unless using a turbo filter.*

## 3. Code Style & Conventions

### Formatting (Strictly Enforced by Biome)
- **Indentation**: Tabs (width 2)
- **Quotes**: Single quotes `'`
- **Semicolons**: Always `;`
- **Line Width**: 100 characters

### TypeScript
- **Strict Mode**: Enabled. No implicit `any`.
- **No Non-Null Assertions**: Do not use `!` for Forbidden non-null assertion. Use optional chaining or type guards.
- **Type Imports**: Use `import type { ... }` for types to ensure proper transpilation.
- **No Enums**: Use `as const` objects instead of TypeScript enums.
  ```typescript
  export const Status = { ACTIVE: 'active', INACTIVE: 'inactive' } as const;
  export type Status = (typeof Status)[keyof typeof Status];
  ```
- **Return Types**: Explicitly define return types for all public API methods.

### Imports
Imports are automatically sorted by Biome. Follow this logical grouping:
1. **URL Imports**
2. **Built-ins** (`node:fs`, `bun:test`)
3. **External Packages** (`mongodb`, `zod`)
4. **Internal Aliases** (`@/utils`, `@monque/core`)
5. **Relative Imports** (`./helper`)

## 4. Architecture & Patterns

### Database (MongoDB)
- **Driver**: Use the **Native MongoDB Driver** (`mongodb`). **NO Mongoose**.
- **Locking**: Atomic `findOneAndUpdate` is MANDATORY for picking up jobs.
  - Query: `{ status: 'pending', nextRunAt: { $lte: now }, $or: [{ claimedBy: null }] }`
  - Update: `{ $set: { status: 'processing', claimedBy: id, lockedAt: now } }`
- **Idempotency**: Use `upsert: true` with `$setOnInsert` on `{ name, uniqueKey }`.

### Core Logic Rules
- **Backoff**: Exponential: `min(2^failCount * base, MAX)`. Reset `status` to `pending`.
- **Heartbeats**: Periodically `updateMany` (`{ claimedBy: id }`) to set `lastHeartbeat`.
- **Recovery**: On startup, reset `processing` jobs where `lockedAt < now - timeout`.
- **Shutdown**: `stop()` must wait for jobs to finish or timeout (leaving them `processing`).

### Documentation
- **Tools**: Use **Mermaid** for diagrams.
- **READMEs**: Must include Installation, Quick Start, API, and Events.

### Testing Strategy
- **Unit**: Mock DB with `vi.spyOn`. Test logic isolation.
- **Integration**: Use `testcontainers`. Test full flow (Enqueue -> Process -> Complete).
- **Scenarios**: MUST test Happy Path, Idempotency, Resilience (Backoff, Race Conditions).

## 5. File Structure
```
monque/
├── apps/               # Example apps and documentation
│   └── docs/           # Documentation site
├── packages/           # Shared libraries
│   ├── core/           # Main scheduler logic (@monque/core)
│   └── tsed/           # Ts.ED integration (@monque/tsed)
├── biome.json          # Linter/Formatter config
└── turbo.json          # Build pipeline config
```

## 6. Workflow Checklist
1. **Understand**: Read related files before editing.
2. **Plan**: Outline changes if complex.
3. **Implement**: Write code following the style guide.
4. **Test**: Add/Update tests to cover changes.
5. **Verify**: Run `bun run check` and `bun run test:unit` before finishing.

---
*Reference: See `.github/copilot-instructions.md` for additional brevity rules.*
