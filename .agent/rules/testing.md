---
trigger: glob
globs: **/*.test.ts
---

# Testing Rules

This project requires **the highest test coverage** that can be done wit healistic scenarios. Use Vitest.

## Running Tests
Always use the predefined scripts in `package.json` to run tests. Do not run `vitest` directly.

### Root Level
```bash
bun run test                # Run all tests
bun run test:unit           # Run all unit tests
bun run test:integration    # Run all integration tests
bun run test:core           # Run core tests only
bun run test:core:unit      # Run core unit tests
bun run test:core:integration # Run core integration tests
bun run test:coverage       # Run test coverage
```

### Package Level
When working within a package (e.g., `packages/core`), use:
```bash
bun run test               # Run all tests for this package
bun run test:unit          # Run unit tests
bun run test:integration   # Run integration tests
bun run test:watch         # Run tests in watch mode
```

## Test Structure
Organize tests by feature and type:

- `tests/unit/`: **Unit Tests**. Fast, isolated.
  - MUST mock all external dependencies (DB, Time).
  - Focus on individual function logic.
  
- `tests/integration/`: **Integration Tests**. Real dependencies.
  - connect to a real MongoDB instance.
  - Verify complete flows (enqueue -> process -> complete).

## Required Scenarios
You MUST test both happy and sad paths.

### 1. Happy Path
- Enqueue -> Worker picks up -> Complete.

### 2. Idempotency (Unique Keys)
- Enqueue duplicate key -> Only one job.
- Complete job -> Enqueue key -> New job.

### 3. Resilience
- **Backoff:** Verify `nextRunAt` calculation.
- **Max Retries:** Verify status becomes `failed`.
- **Race Conditions:** Verify only one worker locks a job.

### 4. Lifecycle
- **Shutdown:** Verify `stop()` waits for jobs or times out.

## Mocking
Use `vi.spyOn(collection, ...)` for DB mocks in unit tests.
Use `vi.useFakeTimers()` for backoff verification.'