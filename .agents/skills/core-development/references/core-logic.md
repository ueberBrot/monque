# Core Logic Patterns

Exact MongoDB query patterns for `@monque/core`. Reference when implementing or modifying job scheduling logic.

## Atomic Locking (Job Claim)

Use `findOneAndUpdate` with the claimed-by pattern:

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

On failure, calculate next run time. Do NOT retry immediately:

```typescript
const delay = Math.pow(2, job.failCount) * baseRetryInterval; // ms
job.nextRunAt = new Date(Date.now() + delay);
job.status = JobStatus.PENDING;
```

If `failCount >= maxRetries`, set `status` to `JobStatus.FAILED`.

## Unique Keys (Idempotency)

When `uniqueKey` is provided, use `findOneAndUpdate` with `upsert` and `$setOnInsert` scoped by `name + uniqueKey`:

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

Periodically update `lastHeartbeat` for all jobs owned by this scheduler instance:

```typescript
const now = new Date();

await collection.updateMany(
  { claimedBy: schedulerInstanceId, status: JobStatus.PROCESSING },
  { $set: { lastHeartbeat: now, updatedAt: now } },
);
```

## Stale Job Recovery

If `recoverStaleJobs` is enabled (default: true), recover stale jobs during initialization:

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

## Graceful Shutdown

- `stop()` MUST stop the polling loop.
- `stop()` MUST wait for in-progress jobs to complete.
- `stop()` MUST enforce a configurable timeout (default: 30s).

## Expected Indexes

- `{ claimedBy: 1, status: 1 }` — heartbeat updates and shutdown cleanup
- `{ lastHeartbeat: 1, status: 1 }` — heartbeat-based observability and stale detection
- `{ lockedAt: 1, lastHeartbeat: 1, status: 1 }` — recovery queries
