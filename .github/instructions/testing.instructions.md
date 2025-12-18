---
applyTo: "**/*.test.ts"
---
# Testing Instructions

This project requires **100% test coverage**. Use Vitest.

## Running Tests

Use `bun` to run tests.

```bash
# Run all tests (uses vitest via package.json script)
bun run test

# Run specific test file (uses vitest directly)
bunx vitest packages/core/tests/enqueue.test.ts
```

## Test Structure

Organize tests by feature:

```
tests/
├── enqueue.test.ts      # Job creation, uniqueKey
├── worker.test.ts       # Job processing, concurrency
├── locking.test.ts      # Atomic lock, race conditions
├── retry.test.ts        # Backoff logic, max retries
├── cron.test.ts         # Cron scheduling
└── errors.test.ts       # Custom error classes
```

## Required Scenarios

### Happy Path
- Enqueue a job -> Worker picks it up -> Status becomes `completed`.

### Unique Keys
- Enqueue with `uniqueKey` -> Enqueue again with same key -> Only one job exists.
- Completed job with `uniqueKey` -> Enqueue again -> New job is created.

### Backoff
- Job fails -> `nextRunAt` is set to `now + 2^failCount * baseRetryInterval` (default 1s).
- Job fails `maxRetries` times -> Status becomes `failed`.

### Race Conditions
- Two workers try to lock the same job -> Only one succeeds.

### Graceful Shutdown
- Call `stop()` while job is processing -> Job completes before shutdown.
- Call `stop()` and timeout expires -> `job:error` event is emitted.

## Mocking Patterns

```typescript
// Simulate DB error
vi.spyOn(collection, 'findOneAndUpdate').mockRejectedValueOnce(new Error('DB Error'));

// Control time for backoff tests
vi.useFakeTimers();
vi.advanceTimersByTime(60_000);
vi.useRealTimers();
```

## Assertions

- Use `expect(job.status).toBe(JobStatus.COMPLETED)` for state checks.
- Use `expect(monque.emit).toHaveBeenCalledWith('job:complete', ...)` for event checks.

