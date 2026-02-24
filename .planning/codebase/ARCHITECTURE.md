# Architecture

**Analysis Date:** 2026-02-24

## Pattern Overview

**Overall:** Facade + Internal Services with Shared Context (manual constructor injection)

**Key Characteristics:**
- `Monque` class is the single public facade; all internal services are hidden behind it
- Services receive a shared `SchedulerContext` interface (not a DI container)
- Services are null-initialized and lazily created in `initialize()`; private getters throw `ConnectionError` if accessed pre-init
- Type-safe `EventEmitter` for observability (overridden `emit`/`on`/`once`/`off` with `MonqueEventMap`)
- MongoDB native driver only — no ORM, no Mongoose (in core)
- Atomic operations via `findOneAndUpdate` for all state transitions
- Dual notification: change streams (primary, real-time) + polling (backup, configurable interval)

## Packages

**`@monque/core`** (`packages/core/`):
- The standalone job scheduler library
- Zero framework dependency — works with any Node.js application
- Peer dependency on `mongodb` ^7.1.0

**`@monque/tsed`** (`packages/tsed/`):
- Ts.ED framework integration via decorators and DI
- Wraps `@monque/core` with `@Module`, `@Injectable`, and decorator-based job registration
- Peer dependencies: `@monque/core`, `@tsed/core`, `@tsed/di`; optional `@tsed/mongoose`

**`@monque/docs`** (`apps/docs/`):
- Astro + Starlight documentation site with TypeDoc API generation
- Not part of the runtime architecture

## Layers (Core Package)

**Public API Layer (Facade):**
- Purpose: Single entry point for all scheduler operations
- Location: `packages/core/src/scheduler/monque.ts`
- Contains: The `Monque` class (1311 lines) — facade that delegates all operations to internal services
- Depends on: All internal services, `SchedulerContext`
- Used by: Consumer applications
- Also handles: index creation (7 indexes), stale job recovery, cleanup interval, heartbeat interval, document-to-type mapping

**Internal Services Layer:**
- Purpose: Decomposed business logic, each service owns a specific concern
- Location: `packages/core/src/scheduler/services/`
- Contains: 5 services, each receiving `SchedulerContext` via constructor
- Depends on: `SchedulerContext`, job types, shared utilities
- Used by: `Monque` facade only (all marked `@internal`)

  **`JobScheduler`** (`packages/core/src/scheduler/services/job-scheduler.ts`):
  - `enqueue()`, `now()`, `schedule()` — create jobs in MongoDB
  - Handles deduplication via `findOneAndUpdate` + `$setOnInsert` with `upsert: true`
  - Validates cron expressions via `getNextCronDate()`

  **`JobProcessor`** (`packages/core/src/scheduler/services/job-processor.ts`):
  - `poll()`, `acquireJob()`, `processJob()`, `completeJob()`, `failJob()`, `updateHeartbeats()`
  - Atomic job claiming: `findOneAndUpdate` with `{ status: PENDING, nextRunAt: $lte now, claimedBy: null }`
  - Exponential backoff retry: `2^failCount × baseRetryInterval` (capped by `maxBackoffDelay`)
  - Recurring jobs: on completion, reset to `pending` with next cron date
  - Dual concurrency: per-worker (`concurrency`) + per-instance (`instanceConcurrency`)
  - Polling guard: `_isPolling` flag prevents concurrent `poll()` execution

  **`JobManager`** (`packages/core/src/scheduler/services/job-manager.ts`):
  - `cancelJob()`, `retryJob()`, `rescheduleJob()`, `deleteJob()`
  - Bulk variants: `cancelJobs()`, `retryJobs()`, `deleteJobs()`
  - State transition validation with `JobStateError` on invalid transitions
  - All atomic operations use `findOneAndUpdate` to handle race conditions

  **`JobQueryService`** (`packages/core/src/scheduler/services/job-query.ts`):
  - `getJob()`, `getJobs()`, `getJobsWithCursor()`, `getQueueStats()`
  - Cursor-based pagination: opaque base64url-encoded ObjectId with direction prefix (`F`/`B`)
  - `getQueueStats()` uses `$facet` aggregation pipeline with `maxTimeMS: 30000`

  **`ChangeStreamHandler`** (`packages/core/src/scheduler/services/change-stream-handler.ts`):
  - MongoDB change stream lifecycle: setup, event handling, reconnection, close
  - Watches for inserts and status-change updates
  - 100ms debounce to prevent "claim storms" from bulk inserts
  - Auto-reconnect with exponential backoff (1s, 2s, 4s) up to 3 attempts
  - Graceful fallback to polling-only mode if change streams unavailable (e.g., standalone MongoDB)

**Types & Domain Layer:**
- Purpose: Type definitions, guards, constants for the job domain
- Location: `packages/core/src/jobs/`, `packages/core/src/events/`, `packages/core/src/workers/`
- Contains: `Job`, `PersistedJob`, `JobStatus`, `MonqueEventMap`, `WorkerRegistration`, type guards
- Depends on: `mongodb` types (ObjectId)
- Used by: All layers

**Shared Utilities Layer:**
- Purpose: Cross-cutting utilities and error hierarchy
- Location: `packages/core/src/shared/`
- Contains: Error classes, backoff calculation, cron parsing
- Depends on: `cron-parser` (external)
- Used by: All services

**Scheduler Helpers:**
- Purpose: Query building, cursor encoding/decoding
- Location: `packages/core/src/scheduler/helpers.ts`
- Contains: `buildSelectorQuery()`, `encodeCursor()`, `decodeCursor()`
- Used by: `JobQueryService`, `JobManager`

## Layers (Ts.ED Package)

**Module Layer:**
- Purpose: Ts.ED lifecycle integration, job discovery, registration
- Location: `packages/tsed/src/monque-module.ts`
- Contains: `MonqueModule` — `@Module` handling `$onInit`/`$onDestroy`
- Depends on: `@monque/core` (`Monque`), `@tsed/di` (`InjectorService`, `Configuration`)
- Lifecycle: resolve DB → create `Monque` → initialize → register jobs → start

**Service Layer:**
- Purpose: Injectable wrapper for DI consumers
- Location: `packages/tsed/src/services/monque-service.ts`
- Contains: `MonqueService` — `@Injectable()` delegating all calls to core `Monque` instance
- Instance set by `MonqueModule._setMonque()` during init

**Decorator Layer:**
- Purpose: Declarative job registration via TypeScript decorators
- Location: `packages/tsed/src/decorators/`
- Contains: `@JobController(namespace)`, `@Job(name)`, `@Cron(pattern)`
- Stores metadata via `@tsed/core` `Store.from(target).set(MONQUE, ...)`

**Utils Layer:**
- Purpose: DB resolution, metadata collection, job naming
- Location: `packages/tsed/src/utils/`
- Contains: `resolveDatabase()` (multi-strategy: `db` / `dbFactory` / `dbToken` / Mongoose), `collectJobMetadata()`, `buildJobName()`, `getJobToken()`

## Data Flow

**Job Lifecycle (Enqueue → Process → Complete):**

1. Consumer calls `monque.enqueue('job-name', data, options)` → delegates to `JobScheduler.enqueue()`
2. `JobScheduler` inserts document into MongoDB collection (`monque_jobs`) with `status: 'pending'`
3. If `uniqueKey` provided: uses `findOneAndUpdate` + `$setOnInsert` for atomic deduplication
4. Change stream fires → `ChangeStreamHandler.handleEvent()` triggers debounced `poll()` (100ms)
5. Alternatively, polling interval (default 1s) triggers `JobProcessor.poll()`
6. `poll()` iterates registered workers, checks concurrency slots (worker-level + instance-level)
7. `acquireJob()`: atomic `findOneAndUpdate` → `{ status: PENDING, nextRunAt ≤ now, claimedBy: null }` → sets `status: PROCESSING, claimedBy: instanceId, lockedAt: now`
8. `processJob()`: calls `worker.handler(job)` in fire-and-forget mode (tracked in `worker.activeJobs`)
9. On success: `completeJob()` → recurring jobs reset to `pending` with next cron date; one-time jobs set to `completed`
10. On failure: `failJob()` → if `failCount < maxRetries`: exponential backoff retry (`status: pending`, calculated `nextRunAt`); otherwise: permanent `failed`
11. Events emitted at each stage: `job:start`, `job:complete`, `job:fail`, `job:error`

**Job Status State Machine:**

```
                    ┌──────────────────────────────┐
                    │                              │
                    ▼                              │
PENDING ──────► PROCESSING ──────► COMPLETED       │ (recurring: back to PENDING)
   │                │                              │
   │                │ (fail + retries remain)      │
   │                └──────────────────────────────┘
   │                │
   │                │ (fail + max retries)
   │                ▼
   │             FAILED
   │
   └──────────► CANCELLED
```

**Stale Job Recovery (on startup):**

1. `initialize()` calls `recoverStaleJobs()` if `recoverStaleJobs: true` (default)
2. Finds jobs where `status: PROCESSING` AND `lockedAt < (now - lockTimeout)`
3. Resets to `pending`, unsets `lockedAt`, `claimedBy`, `lastHeartbeat`, `heartbeatInterval`
4. Emits `stale:recovered` event with count

**Heartbeat Flow (during processing):**

1. `start()` sets up heartbeat interval (default 30s)
2. `updateHeartbeats()` does `updateMany` for all jobs claimed by this instance
3. Updates `lastHeartbeat` and `updatedAt` — primarily for observability/monitoring
4. Note: stale recovery uses `lockedAt + lockTimeout`, NOT heartbeat timestamps

**Graceful Shutdown:**

1. `stop()` sets `isRunning = false` → prevents new job acquisition
2. Closes change stream, clears all intervals (poll, heartbeat, cleanup)
3. Waits for active jobs to complete (polls every 100ms)
4. Race between job completion and `shutdownTimeout` (default 30s)
5. On timeout: emits `ShutdownTimeoutError` with list of incomplete jobs (left as `processing` for stale recovery)

**Job Retention Cleanup:**

1. If `jobRetention` configured, cleanup runs on `start()` and then at configured interval (default 1 hour)
2. Deletes completed jobs older than `jobRetention.completed` ms
3. Deletes failed jobs older than `jobRetention.failed` ms
4. Uses concurrent `deleteMany` operations

## Key Abstractions

**`SchedulerContext`** (`packages/core/src/scheduler/services/types.ts`):
- Purpose: Shared state/dependency container passed to all internal services
- Contains: `collection`, `options`, `instanceId`, `workers` Map, `isRunning()`, `emit()`, `documentToPersistedJob()`
- Pattern: Manual constructor injection (not a DI container)

**`Job<T>` / `PersistedJob<T>`** (`packages/core/src/jobs/types.ts`):
- Purpose: Job document type with generic payload
- `Job<T>`: The shape of a job document (optional `_id`)
- `PersistedJob<T>`: `Job<T> & { _id: ObjectId }` — returned from all operations, guaranteed to have `_id`

**`JobStatus`** (`packages/core/src/jobs/types.ts`):
- Purpose: `as const` object defining job lifecycle states
- Pattern: `const enum alternative` — `JobStatus.PENDING`, `JobStatus.PROCESSING`, etc.
- Union type: `JobStatusType` derived via `(typeof JobStatus)[keyof typeof JobStatus]`

**`MonqueEventMap`** (`packages/core/src/events/types.ts`):
- Purpose: Type-safe event system for job lifecycle observability
- 13 events: `job:start`, `job:complete`, `job:fail`, `job:error`, `job:cancelled`, `job:retried`, `job:deleted`, `stale:recovered`, `changestream:connected`, `changestream:error`, `changestream:closed`, `changestream:fallback`, `jobs:cancelled`, `jobs:retried`, `jobs:deleted`

**`WorkerRegistration`** (`packages/core/src/workers/types.ts`):
- Purpose: Internal tracking of registered job handlers
- Contains: `handler`, `concurrency` limit, `activeJobs` Map (tracks in-flight jobs by ID)

**`MonqueOptions` / `ResolvedMonqueOptions`** (`packages/core/src/scheduler/types.ts`, `packages/core/src/scheduler/services/types.ts`):
- Purpose: Configuration with defaults
- Pattern: `MonqueOptions` (all optional) → `ResolvedMonqueOptions` (defaults applied in constructor)

## Entry Points

**Core Package — `Monque` class:**
- Location: `packages/core/src/scheduler/monque.ts`
- Triggers: `new Monque(db, options)` → `initialize()` → `register()` → `start()`
- Public API barrel: `packages/core/src/index.ts`

**Ts.ED Package — `MonqueModule`:**
- Location: `packages/tsed/src/monque-module.ts`
- Triggers: Ts.ED `@Module` import → `$onInit()` auto-called by framework
- Discovers `@JobController` providers, collects `@Job`/`@Cron` metadata, registers workers
- Public API barrel: `packages/tsed/src/index.ts`

## Error Handling

**Strategy:** Custom error hierarchy with guard-style validation and catch-and-re-wrap at service boundaries

**Error Hierarchy** (`packages/core/src/shared/errors.ts`):
```
MonqueError (base)
├── InvalidCronError      - Invalid cron expression (carries `expression`)
├── ConnectionError       - DB connection / init failure (carries `cause`)
├── ShutdownTimeoutError  - Graceful shutdown timeout (carries `incompleteJobs`)
├── WorkerRegistrationError - Duplicate worker (carries `jobName`)
├── JobStateError         - Invalid state transition (carries `jobId`, `currentStatus`, `attemptedAction`)
├── InvalidCursorError    - Malformed pagination cursor
└── AggregationTimeoutError - Stats aggregation timeout (30s)
```

**Patterns:**
- Guard-style early throws for validation (e.g., `ensureInitialized()`, state checks in `cancelJob`)
- Try/catch with `ConnectionError` re-wrapping at service boundaries (preserves `cause` chain)
- Catch-and-emit for background operations: `catch((error) => this.emit('job:error', { error }))`
- Catch-and-ignore for shutdown cleanup (change stream close errors)
- Error normalization: `const err = error instanceof Error ? error : new Error(String(error))`
- Atomic state checks: `findOneAndUpdate` with status precondition, throw `JobStateError` if `result` is null (race condition)

## Cross-Cutting Concerns

**Logging:**
- Core package: No logging — uses events for observability (`job:start`, `job:complete`, etc.)
- Ts.ED package: Uses `@tsed/di` `LOGGER` for lifecycle messages and error reporting

**Validation:**
- Cron expressions validated via `cron-parser` in `getNextCronDate()`
- ObjectId validation via `ObjectId.isValid()` before all operations
- State transition validation in `JobManager` methods (throw `JobStateError`)
- Config validation in Ts.ED via `validateDatabaseConfig()`

**Concurrency Control:**
- Per-worker: `worker.concurrency` (default 5, configurable per-worker)
- Per-instance: `instanceConcurrency` (optional, caps total across all workers)
- Polling guard: `_isPolling` flag prevents concurrent poll execution
- Atomic claiming: `findOneAndUpdate` prevents double-processing across instances

**MongoDB Indexes** (created in `initialize()`):
1. `{ status, nextRunAt }` — Efficient job polling
2. `{ name, uniqueKey }` — Partial unique index for deduplication (only pending/processing)
3. `{ name, status }` — Job lookup by type
4. `{ claimedBy, status }` — Jobs owned by instance
5. `{ lastHeartbeat, status }` — Monitoring/debugging
6. `{ status, nextRunAt, claimedBy }` — Atomic claim queries
7. `{ status, lockedAt, lastHeartbeat }` — Recovery scans + monitoring

---

*Architecture analysis: 2026-02-24*
