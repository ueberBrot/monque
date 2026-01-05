---
trigger: glob
globs: **/*.test.ts
---

# Testing Rules

This project requires **100% test coverage**. Use Vitest.

## Running Tests
Use `bun` to run tests:
```bash
bun run test
bunx vitest packages/core/tests/integration/enqueue.test.ts
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
Use `vi.useFakeTimers()` for backoff verification.