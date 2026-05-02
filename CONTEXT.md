# Monque Context

Monque is a MongoDB-backed job scheduler. It stores jobs in one collection and coordinates
workers across scheduler instances with atomic MongoDB writes.

## Domain Vocabulary

**Job** — persisted unit of background work. It has a name, payload, lifecycle status,
schedule time, retry metadata, and optional recurring schedule.

**Worker** — registered handler for one job name. Worker concurrency limits how many jobs
with that name can run at once in one scheduler instance.

**Scheduler Instance** — running Monque process identified by `schedulerInstanceId`.
It claims jobs, sends heartbeats, and releases ownership when work completes.

**Claim** — atomic transition from pending to processing. A claim writes `claimedBy`,
`lockedAt`, `lastHeartbeat`, and `heartbeatInterval`.

**Owned Job** — processing job whose `claimedBy` matches current scheduler instance.
Completion and failure transitions require ownership.

**Stale Job** — processing job whose `lockedAt` is older than `lockTimeout`. Stale recovery
resets it to pending and clears claim fields.

**Heartbeat** — liveness signal written to `lastHeartbeat` while a job is processing.
It supports monitoring and instance collision checks; stale recovery uses `lockedAt`.

**Pending Notification** — local signal that a pending job exists at `nextRunAt`.
Change streams, retries, reschedules, recurring completion, and intake use this to reduce
polling latency.

**Unique Key** — deduplication key scoped by job name and active statuses. Pending and
processing jobs block duplicates; completed and failed jobs do not.

**Retention** — optional cleanup policy for completed and failed jobs based on `updatedAt`.

## Load-Bearing Rules

- Claims and owned-job transitions use atomic MongoDB preconditions.
- Stale recovery uses `lockedAt + lockTimeout`, not `lastHeartbeat`.
- `lastHeartbeat` is still load-bearing for instance collision checks and observability.
- Public scheduler methods remain on `Monque`; internal modules hide persistence detail.
- Change streams are an optimization. Polling remains required as safety net and fallback.
