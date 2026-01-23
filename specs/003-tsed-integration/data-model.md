# Data Model: @monque/tsed

**Feature**: 003-tsed-integration
**Date**: 2026-01-22

## Overview

This document defines the data structures and metadata used by the `@monque/tsed` package. The integration layer primarily works with metadata stored via decorators and configuration objects.

---

## Entity Definitions

### 1. MonqueTsedConfig

Configuration object passed to Ts.ED's `@Configuration` decorator.

```typescript
interface MonqueTsedConfig extends Omit<MonqueOptions, 'db'> {
  /**
   * Enable/disable the Monque module.
   * When false, workers are not registered and lifecycle hooks are no-ops.
   * @default true
   */
  enabled?: boolean;

  /**
   * Direct MongoDB database instance.
   * Use when you have a pre-connected Db object.
   */
  db?: Db;

  /**
   * Factory function to create the database connection.
   * Called once during module initialization.
   * Supports async factories for connection pooling.
   */
  dbFactory?: () => Promise<Db> | Db;

  /**
   * DI token to inject the Db instance from the container.
   * Use when your app already has a MongoDB provider.
   */
  dbToken?: TokenProvider<Db> | string;
}
```

**Validation rules**:
- Exactly one of `db`, `dbFactory`, or `dbToken` must be provided (when `enabled` is true)
- All `MonqueOptions` fields are forwarded to the `Monque` constructor

**Relationships**:
- Extends `MonqueOptions` from `@monque/core`
- Used by `MonqueModule` for initialization

---

### 2. WorkerStore (Decorator Metadata)

Metadata structure stored on classes decorated with `@WorkerController`.

```typescript
interface WorkerStore {
  /**
   * Type identifier for the store.
   * Always "controller" for WorkerController.
   */
  type: "controller";

  /**
   * Optional namespace prefix for all jobs in this controller.
   * When set, job names become "{namespace}.{name}".
   */
  namespace?: string;

  /**
   * Worker method registrations from @Worker decorators.
   */
  workers: WorkerMetadata[];

  /**
   * Cron job registrations from @Cron decorators.
   */
  cronJobs: CronMetadata[];
}
```

**Storage location**: Attached to class constructor via `Store.from(Class).set(MONQUE, metadata)`

---

### 3. WorkerMetadata

Metadata for a single `@Worker`-decorated method.

```typescript
interface WorkerMetadata {
  /**
   * Job name (without namespace prefix).
   * Combined with controller namespace to form full job name.
   */
  name: string;

  /**
   * Method name on the controller class.
   */
  method: string;

  /**
   * Worker options forwarded to Monque.register().
   */
  opts: WorkerDecoratorOptions;
}

interface WorkerDecoratorOptions extends WorkerOptions {
  /**
   * Inherits all options from @monque/core WorkerOptions:
   * - concurrency?: number
   * - replace?: boolean
   */
}
```

**Validation rules**:
- `name` must be a non-empty string
- `method` must reference an existing method on the class

---

### 4. CronMetadata

Metadata for a single `@Cron`-decorated method.

```typescript
interface CronMetadata {
  /**
   * Cron expression (5-field standard or predefined like @daily).
   */
  pattern: string;

  /**
   * Job name (defaults to method name if not specified in options).
   */
  name: string;

  /**
   * Method name on the controller class.
   */
  method: string;

  /**
   * Schedule options forwarded to Monque.schedule().
   */
  opts: CronDecoratorOptions;
}

interface CronDecoratorOptions extends ScheduleOptions {
  /**
   * Override job name (defaults to method name).
   *
   * Inherits all options from @monque/core ScheduleOptions:
   * - runAt?: Date
   * - uniqueKey?: string
   */
  name?: string;
}
```

**Validation rules**:
- `pattern` must be a valid cron expression (validated by `@monque/core`)
- `method` must reference an existing method on the class

---

### 5. WorkerMethods (Handler Interface)

Interface for controller methods that handle jobs.

```typescript
interface WorkerMethods<T = unknown, R = unknown> {
  /**
   * Handle a job execution.
   * Called by MonqueModule when a job is picked up by the worker.
   *
   * @param job - The full job object including metadata
   * @returns Result value (typically void or ignored)
   */
  (job: Job<T>): R | Promise<R>;
}
```

**Note**: Unlike `@tsed/bullmq`'s `JobMethods` which has a `handle(payload, job)` signature, we pass the full `Job` object directly to align with `@monque/core`'s handler pattern.

---

### 6. MonqueService (Injectable Wrapper)

Service class that wraps `Monque` for DI injection. Exposes the full Monque public API. See `contracts/services.ts` for the complete interface definition (`IMonqueService`).

```typescript
class MonqueService implements IMonqueService {
  /**
   * Internal Monque instance (set by MonqueModule).
   * @internal
   */
  private _monque: Monque | null;

  /**
   * Access the underlying Monque instance.
   * @throws Error if MonqueModule is not initialized
   */
  get monque(): Monque;

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Scheduling
  // ─────────────────────────────────────────────────────────────────────────────

  /** Enqueue a job for processing */
  enqueue<T>(name: string, data: T, options?: EnqueueOptions): Promise<PersistedJob<T>>;
  
  /** Enqueue a job for immediate processing */
  now<T>(name: string, data: T): Promise<PersistedJob<T>>;
  
  /** Schedule a recurring job with cron expression */
  schedule<T>(cron: string, name: string, data: T, options?: ScheduleOptions): Promise<PersistedJob<T>>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Management (Single Job)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Cancel a pending or scheduled job */
  cancelJob(jobId: string): Promise<PersistedJob<unknown> | null>;
  
  /** Retry a failed or cancelled job */
  retryJob(jobId: string): Promise<PersistedJob<unknown> | null>;
  
  /** Reschedule a pending job to a different time */
  rescheduleJob(jobId: string, runAt: Date): Promise<PersistedJob<unknown> | null>;
  
  /** Permanently delete a job */
  deleteJob(jobId: string): Promise<boolean>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Management (Bulk Operations)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Cancel multiple jobs matching a filter */
  cancelJobs(filter: JobSelector): Promise<BulkOperationResult>;
  
  /** Retry multiple jobs matching a filter */
  retryJobs(filter: JobSelector): Promise<BulkOperationResult>;
  
  /** Delete multiple jobs matching a filter */
  deleteJobs(filter: JobSelector): Promise<BulkOperationResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Queries
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get a job by ID (accepts string or ObjectId) */
  getJob<T>(jobId: string | ObjectId): Promise<PersistedJob<T> | null>;
  
  /** Query jobs with optional filters */
  getJobs<T>(filter?: GetJobsFilter): Promise<PersistedJob<T>[]>;
  
  /** Get jobs with cursor-based pagination */
  getJobsWithCursor<T>(options?: CursorOptions): Promise<CursorPage<T>>;
  
  /** Get queue statistics */
  getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Health Check
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if scheduler is healthy and running */
  isHealthy(): boolean;
}
```

**State transitions**: `null` -> `Monque` (during `MonqueModule.$onInit`)

**Note**: `getJob()` accepts both `string` and `ObjectId` as a convenience - the implementation converts strings to ObjectId before delegating to `Monque.getJob()`. All other methods delegate directly to the underlying Monque instance.

---

## State Diagrams

### MonqueModule Lifecycle

```
[Not Loaded]
     |
     v (TsED bootstrap)
[Constructor]
     | - Build queue providers
     | - Scan WorkerController providers
     v
[$onInit]
     | - Resolve database (db/dbFactory/dbToken)
     | - Validate no duplicate job registrations (throws if duplicates found)
     | - Create Monque instance
     | - Call monque.initialize() (throws if connection fails → abort startup)
     | - Register all workers from metadata
     | - Schedule all cron jobs
     | - Call monque.start()
     v
[Running]
     | - Processing jobs
     | - On DI resolution error: mark job failed, log error, continue worker
     | - On handler throw: standard Monque failure behavior
     v (TsED shutdown)
[$onDestroy]
     | - Call monque.stop()
     | - Wait for graceful shutdown
     v
[Stopped]
```

### Job Registration Flow

```
@WorkerController("email")     @Worker("send")
         |                           |
         v                           v
   Store.set(MONQUE, {         Store.merge(MONQUE, {
     type: "controller",         workers: [{
     namespace: "email",           name: "send",
     workers: [],                  method: "sendEmail",
     opts: {}
   })                            }]
         })
         |                       })
         v                           |
   Injectable({                      |
     type: WORKER_CONTROLLER         |
   })                                |
         \__________________________|
                    |
                    v
           MonqueModule.$onInit()
                    |
                    v
           monque.register("email.send", handler)
```

---

## Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                     TsED Configuration                      │
│  @Configuration({ monque: MonqueTsedConfig })               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ reads
                              v
┌─────────────────────────────────────────────────────────────┐
│                      MonqueModule                           │
│  - Implements OnInit, OnDestroy                             │
│  - Creates Monque instance                                  │
│  - Registers workers from metadata                          │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              v               v               v
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │MonqueService│   │   Monque    │   │ WorkerCtrl  │
    │  (wrapper)  │   │ (@monque/   │   │  providers  │
    │             │   │   core)     │   │             │
    └─────────────┘   └─────────────┘   └─────────────┘
          │                 │                 │
          │ proxies to      │ manages         │ stores
          │                 v                 v
          │          ┌─────────────┐   ┌─────────────┐
          └─────────>│    Jobs     │   │ WorkerStore │
                     │  (MongoDB)  │   │  (metadata) │
                     └─────────────┘   └─────────────┘
```

---

## DI Scoping Rules

The integration creates a **Discrete DI Context** for each job execution using `injector.runInContext()`.

- **Context Type**: The context mimics a standard Ts.ED Request Scope.
- **Request Scoped Providers**: Providers decorated with `@Scope(ProviderScope.REQUEST)` are instantiated freshly for each job.
- **Singleton Providers**: Providers decorated with `@Scope(ProviderScope.SINGLETON)` (default) are shared across all jobs.
- **Context Access**: The `Job` instance is available via dependency injection (future scope) or context accessor.

---

## Constants

```typescript
// Store key for decorator metadata
export const MONQUE = Symbol.for("monque");

// Provider types for DI scanning
export const ProviderTypes = {
  WORKER_CONTROLLER: "monque:worker-controller",
  CRON: "monque:cron",
} as const;
```

**Validation rules**:
- `name` must be a non-empty string
- `method` must reference an existing method on the class

---

### 4. CronMetadata

Metadata for a single `@Cron`-decorated method.

```typescript
interface CronMetadata {
  /**
   * Cron expression (5-field standard or predefined like @daily).
   */
  pattern: string;

  /**
   * Job name (defaults to method name if not specified in options).
   */
  name: string;

  /**
   * Method name on the controller class.
   */
  method: string;

  /**
   * Schedule options forwarded to Monque.schedule().
   */
  opts: CronDecoratorOptions;
}

interface CronDecoratorOptions extends ScheduleOptions {
  /**
   * Override job name (defaults to method name).
   */
  name?: string;
}
```

**Validation rules**:
- `pattern` must be a valid cron expression (validated by `@monque/core`)
- `method` must reference an existing method on the class

---

### 5. WorkerMethods (Handler Interface)

Interface for controller methods that handle jobs.

```typescript
interface WorkerMethods<T = unknown, R = unknown> {
  /**
   * Handle a job execution.
   * Called by MonqueModule when a job is picked up by the worker.
   *
   * @param job - The full job object including metadata
   * @returns Result value (ignored for most use cases)
   */
  (job: Job<T>): R | Promise<R>;
}
```

**Note**: Unlike `@tsed/bullmq`'s `JobMethods` which has a `handle(payload, job)` signature, we pass the full `Job` object directly to align with `@monque/core`'s handler pattern.

---

### 6. MonqueService (Injectable Wrapper)

Service class that wraps `Monque` for DI injection. Exposes the full Monque public API. See `contracts/services.ts` for the complete interface definition (`IMonqueService`).

```typescript
class MonqueService implements IMonqueService {
  /**
   * Internal Monque instance (set by MonqueModule).
   * @internal
   */
  private _monque: Monque | null;

  /**
   * Access the underlying Monque instance.
   * @throws Error if MonqueModule is not initialized
   */
  get monque(): Monque;

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Scheduling
  // ─────────────────────────────────────────────────────────────────────────────

  /** Enqueue a job for processing */
  enqueue<T>(name: string, data: T, options?: EnqueueOptions): Promise<PersistedJob<T>>;
  
  /** Enqueue a job for immediate processing */
  now<T>(name: string, data: T): Promise<PersistedJob<T>>;
  
  /** Schedule a recurring job with cron expression */
  schedule<T>(cron: string, name: string, data: T, options?: ScheduleOptions): Promise<PersistedJob<T>>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Management (Single Job)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Cancel a pending or scheduled job */
  cancelJob(jobId: string): Promise<PersistedJob<unknown> | null>;
  
  /** Retry a failed or cancelled job */
  retryJob(jobId: string): Promise<PersistedJob<unknown> | null>;
  
  /** Reschedule a pending job to a different time */
  rescheduleJob(jobId: string, runAt: Date): Promise<PersistedJob<unknown> | null>;
  
  /** Permanently delete a job */
  deleteJob(jobId: string): Promise<boolean>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Management (Bulk Operations)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Cancel multiple jobs matching a filter */
  cancelJobs(filter: JobSelector): Promise<BulkOperationResult>;
  
  /** Retry multiple jobs matching a filter */
  retryJobs(filter: JobSelector): Promise<BulkOperationResult>;
  
  /** Delete multiple jobs matching a filter */
  deleteJobs(filter: JobSelector): Promise<BulkOperationResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Queries
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get a job by ID (accepts string or ObjectId) */
  getJob<T>(jobId: string | ObjectId): Promise<PersistedJob<T> | null>;
  
  /** Query jobs with optional filters */
  getJobs<T>(filter?: GetJobsFilter): Promise<PersistedJob<T>[]>;
  
  /** Get jobs with cursor-based pagination */
  getJobsWithCursor<T>(options?: CursorOptions): Promise<CursorPage<T>>;
  
  /** Get queue statistics */
  getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Health Check
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if scheduler is healthy and running */
  isHealthy(): boolean;
}
```

**State transitions**: `null` -> `Monque` (during `MonqueModule.$onInit`)

**Note**: `getJob()` accepts both `string` and `ObjectId` as a convenience - the implementation converts strings to ObjectId before delegating to `Monque.getJob()`. All other methods delegate directly to the underlying Monque instance.

---

## State Diagrams

### MonqueModule Lifecycle

```
[Not Loaded]
     |
     v (TsED bootstrap)
[Constructor]
     | - Build queue providers
     | - Scan WorkerController providers
     v
[$onInit]
     | - Resolve database (db/dbFactory/dbToken)
     | - Validate no duplicate job registrations (throws if duplicates found)
     | - Create Monque instance
     | - Call monque.initialize() (throws if connection fails → abort startup)
     | - Register all workers from metadata
     | - Schedule all cron jobs
     | - Call monque.start()
     v
[Running]
     | - Processing jobs
     | - On DI resolution error: mark job failed, log error, continue worker
     | - On handler throw: standard Monque failure behavior
     v (TsED shutdown)
[$onDestroy]
     | - Call monque.stop()
     | - Wait for graceful shutdown
     v
[Stopped]
```

### Job Registration Flow

```
@WorkerController("email")     @Worker("send")
         |                           |
         v                           v
   Store.set(MONQUE, {         Store.merge(MONQUE, {
     type: "controller",         workers: [{
     namespace: "email",           name: "send",
     workers: [],                  method: "sendEmail",
     cronJobs: []                  opts: {}
   })                            }]
         |                       })
         v                           |
   Injectable({                      |
     type: WORKER_CONTROLLER         |
   })                                |
         \__________________________|
                    |
                    v
           MonqueModule.$onInit()
                    |
                    v
           monque.register("email.send", handler)
```

---

## Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                     TsED Configuration                      │
│  @Configuration({ monque: MonqueTsedConfig })               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ reads
                              v
┌─────────────────────────────────────────────────────────────┐
│                      MonqueModule                           │
│  - Implements OnInit, OnDestroy                             │
│  - Creates Monque instance                                  │
│  - Registers workers from metadata                          │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              v               v               v
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │MonqueService│   │   Monque    │   │ WorkerCtrl  │
    │  (wrapper)  │   │ (@monque/   │   │  providers  │
    │             │   │   core)     │   │             │
    └─────────────┘   └─────────────┘   └─────────────┘
          │                 │                 │
          │ proxies to      │ manages         │ stores
          │                 v                 v
          │          ┌─────────────┐   ┌─────────────┐
          └─────────>│    Jobs     │   │ WorkerStore │
                     │  (MongoDB)  │   │  (metadata) │
                     └─────────────┘   └─────────────┘
```

---

## DI Scoping Rules

The integration creates a **Discrete DI Context** for each job execution using `injector.runInContext()`.

- **Context Type**: The context mimics a standard Ts.ED Request Scope.
- **Request Scoped Providers**: Providers decorated with `@Scope(ProviderScope.REQUEST)` are instantiated freshly for each job.
- **Singleton Providers**: Providers decorated with `@Scope(ProviderScope.SINGLETON)` (default) are shared across all jobs.
- **Context Access**: The `Job` instance is available via dependency injection (future scope) or context accessor.

---

## Constants

```typescript
// Store key for decorator metadata
export const MONQUE = Symbol.for("monque");

// Provider types for DI scanning
export const ProviderTypes = {
  WORKER_CONTROLLER: "monque:worker-controller",
  CRON: "monque:cron",
} as const;
```
