---
trigger: glob
globs: packages/core/src/**/*.ts
---

# Core Logic Rules

You are working on `@monque/core`, a MongoDB-backed job scheduler.

## Fundamental Rules
- **Inheritance:** The `Monque` class MUST extend `EventEmitter`.
- **Database:** ONLY use the native `mongodb` driver. Do NOT use Mongoose or any ORM.
- **Types:** Use `JobStatus` as an `as const` object, NOT an enum.
- **Generics:** The `Job<T>` interface MUST be generic for the `data` payload.

## Atomic Locking
When picking up jobs, you MUST use `findOneAndUpdate` with these exact semantics:

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
const delay = Math.pow(2, job.failCount) * 1_000; // ms (DEFAULT_BASE_INTERVAL)
job.nextRunAt = new Date(Date.now() + delay);
job.status = JobStatus.PENDING;
```
If `failCount >= maxRetries`, set `status` to `JobStatus.FAILED`.

## Unique Keys (Idempotency)
When `uniqueKey` is provided, use `updateOne` with `upsert` and `$setOnInsert`:
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