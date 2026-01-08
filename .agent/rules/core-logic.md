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
When picking up jobs, you MUST use `findOneAndUpdate` with these exact semantics (claimed-by pattern):

```typescript
const now = new Date();

await collection.findOneAndUpdate(
  {
    name,
    status: JobStatus.PENDING,
    nextRunAt: { $lte: now },
    $or: [{ claimedBy: null }, { claimedBy: { $exists: false } }],
  },
  {
    $set: {
      status: JobStatus.PROCESSING,
      claimedBy: schedulerInstanceId,
      lockedAt: now,
      lastHeartbeat: now,
      heartbeatInterval,
      updatedAt: now,
    },
  },
  { sort: { nextRunAt: 1 }, returnDocument: 'after' },
);
```

## Exponential Backoff
On failure, do NOT retry immediately. Calculate the next run time:
```typescript
const delay = Math.pow(2, job.failCount) * baseRetryInterval; // ms
job.nextRunAt = new Date(Date.now() + delay);
job.status = JobStatus.PENDING;
```
If `failCount >= maxRetries`, set `status` to `JobStatus.FAILED`.

## Unique Keys (Idempotency)
When `uniqueKey` is provided, use `findOneAndUpdate` with `upsert` and `$setOnInsert` (scoped by `name + uniqueKey`) so the call can return the existing pending/processing job:
```typescript
await collection.findOneAndUpdate(
  {
    name,
    uniqueKey,
    status: { $in: [JobStatus.PENDING, JobStatus.PROCESSING] },
  },
  { $setOnInsert: { ...jobDocument } },
  { upsert: true, returnDocument: 'after' },
);
```

## Heartbeat Monitoring
During job processing, the scheduler MUST periodically update `lastHeartbeat` for all jobs it currently owns.

Required behavior:
- When a job is claimed, set `lastHeartbeat` to now and persist `heartbeatInterval` on the job document.
- While running, update heartbeats using `updateMany` scoped to the scheduler instance:

```typescript
const now = new Date();

await collection.updateMany(
  { claimedBy: schedulerInstanceId, status: JobStatus.PROCESSING },
  { $set: { lastHeartbeat: now, updatedAt: now } },
);
```

Indexes (expected):
- `{ claimedBy: 1, status: 1 }` for heartbeat updates and shutdown cleanup.
- `{ lastHeartbeat: 1, status: 1 }` for heartbeat-based observability and stale detection.

## Stale Job Recovery
If `recoverStaleJobs` is enabled (default: true), the scheduler MUST attempt to recover stale jobs during initialization.

Stale definition (current behavior):
- A job is stale if `status === JobStatus.PROCESSING` and `lockedAt < (now - lockTimeout)`.

Recovery semantics (must be implemented via `updateMany`):

```typescript
const staleThreshold = new Date(Date.now() - lockTimeout);

await collection.updateMany(
  { status: JobStatus.PROCESSING, lockedAt: { $lt: staleThreshold } },
  {
    $set: { status: JobStatus.PENDING, updatedAt: new Date() },
    $unset: { lockedAt: '', claimedBy: '', lastHeartbeat: '', heartbeatInterval: '' },
  },
);
```

Indexes (expected):
- `{ lockedAt: 1, lastHeartbeat: 1, status: 1 }` to support recovery queries.

## Graceful Shutdown
- `stop()` MUST stop the polling loop.
- `stop()` MUST wait for in-progress jobs to complete.
- `stop()` MUST enforce a configurable timeout (default: 30s).