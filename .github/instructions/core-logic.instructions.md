---
applyTo: "packages/core/src/**/*.ts"
---
# Core Logic Instructions

You are working on `@monque/core`, a MongoDB-backed job scheduler.

## Rules

- The `Monque` class MUST extend `EventEmitter`.
- ONLY use the native `mongodb` driver. Do NOT use Mongoose or any ORM.
- Use `JobStatus` as an `as const` object, NOT an enum.
- The `Job<T>` interface MUST be generic for the `data` payload.

## Package Manager

Use `bun` for all package management and script execution tasks.

```bash
# Install dependencies
bun install

# Run scripts
bun run build
bun run test
bun run lint
```

## Atomic Locking

When picking up jobs, use `findOneAndUpdate` with these exact semantics:

```typescript
await collection.findOneAndUpdate(
  { status: JobStatus.PENDING, nextRunAt: { $lte: new Date() } },
  { $set: { status: JobStatus.PROCESSING, lockedAt: new Date() } },
  { sort: { nextRunAt: 1 }, returnDocument: 'after' }
);
```

## Exponential Backoff

On failure, do NOT retry immediately. Calculate the next run time:

```typescript
const delay = Math.pow(2, job.failCount) * 60_000; // ms
job.nextRunAt = new Date(Date.now() + delay);
job.status = JobStatus.PENDING;
```

If `failCount >= maxRetries`, set `status` to `JobStatus.FAILED`.

## Unique Keys (Idempotency)

When `uniqueKey` is provided, use `updateOne` with `upsert`:

```typescript
await collection.updateOne(
  { uniqueKey, status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] } },
  { $setOnInsert: { ...jobDocument } },
  { upsert: true }
);
```

## Graceful Shutdown

- `stop()` MUST stop the polling loop.
- `stop()` MUST wait for in-progress jobs to complete.
- `stop()` MUST enforce a configurable timeout (default: 30s).

## Events

Emit these events on the `Monque` instance:
- `job:start` - When a job begins processing.
- `job:complete` - When a job finishes successfully.
- `job:fail` - When a job fails and will be retried.
- `job:error` - When an unrecoverable error occurs.

