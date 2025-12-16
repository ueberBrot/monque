# Specify

## Project Overview

Scaffold and implement a monorepo project for a new job scheduler library called **"Monque"** (Mongo Queue).

## Package Structure

The project consists of two packages:

### Package A: Core Scheduler (`@monque/core`)

The foundational job scheduling library.

### Package B: Framework Integration (`@monque/tsed`)

Framework-specific integration package for Ts.ED.

---

## Requirements

### Core Package Requirements

#### Job Enqueueing

- **One-off Jobs:** Support `enqueue<T>(name, data, options)` for single execution jobs.
- **Unique Jobs:** Support a `uniqueKey` option to prevent duplicate jobs (crucial for data syncing scenarios).
- **Scheduled Jobs:** Support `schedule(cronExpression, name, data)` for recurring jobs using cron expressions.

#### Worker Registration

- **Handler Registration:** Support `worker(name, handler)` to register job processors.
- **Concurrent Processing:** Workers should be able to process jobs concurrently.

#### Job Locking

- **Atomic Locking:** Use atomic database operations to lock jobs for processing.
- **Lock Query:** Find jobs where `status: 'pending'` and `nextRunAt <= NOW`.
- **Lock Update:** Set `status: 'processing'` and `lockedAt: NOW`.

#### Resilience

- **Exponential Backoff:** When a job fails, calculate next retry as `nextRunAt = now + (2^failCount * baseInterval)`.
- **Fail Tracking:** Track failure count and failure reasons.

#### Lifecycle Management

- **Graceful Shutdown:** `stop()` method that stops polling and waits for processing jobs to complete.
- **Configurable Timeout:** Support timeout configuration for shutdown waiting period.

#### Observability

- **Event Emission:** Emit events for job lifecycle:
  - `job:start` - When a job begins processing
  - `job:complete` - When a job finishes successfully
  - `job:fail` - When a job fails
  - `job:error` - When an unexpected error occurs

### Framework Integration Requirements

#### Module System

- **Configurable Module:** Accept connection configuration via dependency injection.
- **Hybrid Connection Support:**
  - Support Mongoose Connection (extract native `.db` handle)
  - Support Native Db directly

#### Decorator Support

- **Job Decorator:** `@Job({ name: string, ... })` decorator to register classes as workers.

#### Dependency Injection

- **Full DI Access:** Job classes must have full access to the framework's DI container.
- **Service Injection:** Workers can inject services, repositories, and other dependencies.

---

## User Stories

### As a Developer

1. **I want to** enqueue a one-off job **so that** I can process async tasks outside the request cycle.
2. **I want to** schedule recurring jobs with cron expressions **so that** I can automate periodic tasks.
3. **I want to** prevent duplicate jobs **so that** data sync operations don't create redundant work.
4. **I want to** have failed jobs retry with backoff **so that** temporary failures don't cause permanent job loss.
5. **I want to** gracefully shutdown the scheduler **so that** in-progress jobs complete before the process exits.
6. **I want to** monitor job lifecycle events **so that** I can implement logging and alerting.

### As a Ts.ED Developer

1. **I want to** use decorators to define job handlers **so that** job registration follows framework conventions.
2. **I want to** inject services into job handlers **so that** I can reuse existing business logic.
3. **I want to** use either Mongoose or native MongoDB **so that** I can integrate with my existing database setup.

---

## Data Model

### Job Interface

```
IJob<T>:
  - _id: ObjectId (optional)
  - name: string
  - data: T
  - status: JobStatus
  - nextRunAt: Date
  - lockedAt: Date | null (optional)
  - failCount: number
  - failReason: string (optional)
  - repeatInterval: string (optional)
  - uniqueKey: string (optional)
```

### Job Status Values

```
JobStatus:
  - PENDING: 'pending'
  - PROCESSING: 'processing'
  - COMPLETED: 'completed'
  - FAILED: 'failed'
```
