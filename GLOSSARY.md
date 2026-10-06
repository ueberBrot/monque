# Monque

Monque is a MongoDB-backed job scheduler. It stores jobs in one collection and coordinates
workers across scheduler instances with atomic MongoDB writes.

## Language

**Job** — persisted unit of background work. It has a name, payload, lifecycle status,
schedule time, retry metadata, and optional recurring schedule.

**Worker** — registered handler for one job name. Worker concurrency limits how many jobs
with that name can run at once in one scheduler instance.

**Job Name** — stable identifier that groups jobs for worker registration, filtering, and
operator views.
_Avoid_: queue, topic, task type

**Queue View** — operator-facing grouping by job name that can include persisted jobs and
registered workers.
_Avoid_: queue entity

**Management Surface** — framework-agnostic operator interface for inspecting jobs and
requesting public Monque management operations.
_Avoid_: dashboard API, agnostic API

**Management Adapter** — framework-specific package that exposes the Management Surface
through a server integration.
_Avoid_: dashboard plugin

**Management Route Map** — versioned HTTP contract implemented as an oRPC router and used
by Management Adapters, OpenAPI generation, and Dashboard clients.
_Avoid_: dashboard routes, adapter routes

**Dashboard** — bundled operator UI for inspecting Queue Views and operating Jobs through
the Management Route Map.
_Avoid_: dashboard server, management adapter

**Scheduler Instance** — running Monque process identified by `schedulerInstanceId`.
It claims jobs, sends heartbeats, and releases ownership when work completes.

**Claim** — atomic transition from pending to processing. A claim writes `claimedBy`,
a unique `claimId`, `lockedAt`, `lastHeartbeat`, and `heartbeatInterval`.

**Owned Job** — processing job whose `claimedBy` matches the current scheduler instance
and whose `claimId` matches the execution's claim. Completion and failure require that claim.

**Stale Job** — processing job whose claim deadline has expired: `leaseExpiresAt` for a
renewable claim, or `lockedAt + lockTimeout` for an absolute lock. Recovery resets it to
pending and clears claim fields.

**Heartbeat** — liveness signal written to `lastHeartbeat` while a job is processing.
It supports monitoring and instance collision checks. With renewable leases enabled it also
extends the claim deadline; it does not extend an absolute lock.

**Pending Notification** — local signal that a pending job exists at `nextRunAt`.
Change streams, retries, reschedules, recurring completion, and intake use this to reduce
polling latency.

**Unique Key** — deduplication key scoped by job name and active statuses. Pending and
processing jobs block duplicates; completed and failed jobs do not.

**Retention** — optional cleanup policy for completed and failed jobs based on `updatedAt`.
