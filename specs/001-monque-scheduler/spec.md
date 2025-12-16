# Feature Specification: Monque Job Scheduler Library

**Feature Branch**: `001-monque-scheduler`  
**Created**: 16 December 2025  
**Status**: Draft  
**Input**: User description: "Scaffold and implement a monorepo project for a new job scheduler library called Monque (Mongo Queue) with core scheduling package and Ts.ED framework integration"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enqueue and Process One-off Jobs (Priority: P1)

As a developer, I want to enqueue a one-off job and have it processed by a registered worker so that I can execute async tasks outside the request cycle.

**Why this priority**: This is the fundamental capability of any job queue system. Without basic job enqueueing and processing, no other features matter.

**Independent Test**: Can be fully tested by enqueueing a job with data and verifying the registered worker receives and processes it. Delivers immediate value for any async processing needs.

**Acceptance Scenarios**:

1. **Given** a worker registered for job name "send-email", **When** I enqueue a job with name "send-email" and data `{to: "user@example.com", subject: "Welcome"}`, **Then** the worker receives the job and can access the data
2. **Given** a job is enqueued, **When** the worker completes processing, **Then** the job status changes to "completed"
3. **Given** multiple jobs are enqueued, **When** workers are processing, **Then** jobs are processed concurrently up to the configured concurrency limit

---

### User Story 2 - Prevent Duplicate Jobs with Unique Keys (Priority: P1)

As a developer, I want to prevent duplicate jobs using a unique key so that data sync operations don't create redundant work.

**Why this priority**: Critical for data integrity in sync scenarios. Duplicate jobs can cause data corruption, wasted resources, and inconsistent state.

**Independent Test**: Can be tested by enqueueing multiple jobs with the same uniqueKey and verifying only one job exists and is processed.

**Acceptance Scenarios**:

1. **Given** a job with uniqueKey "sync-user-123" exists with status "pending", **When** I enqueue another job with the same uniqueKey, **Then** no duplicate job is created
2. **Given** a job with uniqueKey "sync-user-123" exists with status "processing", **When** I enqueue another job with the same uniqueKey, **Then** no duplicate job is created
3. **Given** a job with uniqueKey "sync-user-123" has status "completed", **When** I enqueue another job with the same uniqueKey, **Then** a new job is created (completed jobs don't block new ones)

---

### User Story 3 - Retry Failed Jobs with Exponential Backoff (Priority: P1)

As a developer, I want failed jobs to retry automatically with exponential backoff so that temporary failures don't cause permanent job loss.

**Why this priority**: Essential for system resilience. Without retry logic, transient failures (network issues, service unavailability) would require manual intervention.

**Independent Test**: Can be tested by creating a job that fails, then verifying it's rescheduled with increasing delays based on fail count.

**Acceptance Scenarios**:

1. **Given** a job fails for the first time, **When** calculating next retry, **Then** nextRunAt is set to now + (2^1 × baseInterval)
2. **Given** a job has failed 3 times, **When** it fails again, **Then** nextRunAt is set to now + (2^4 × baseInterval) and failCount is 4
3. **Given** a job fails, **When** the failure is recorded, **Then** the failReason is stored with the job for debugging
4. **Given** a job has reached maximum retry attempts, **When** it fails again, **Then** the job status becomes "failed" permanently

---

### User Story 4 - Schedule Recurring Jobs with Cron (Priority: P2)

As a developer, I want to schedule recurring jobs with cron expressions so that I can automate periodic tasks.

**Why this priority**: Important for automation but not required for basic queue functionality. Systems can operate with one-off jobs initially.

**Independent Test**: Can be tested by scheduling a job with a cron expression and verifying it runs at the expected times and re-schedules itself.

**Acceptance Scenarios**:

1. **Given** I schedule a job with cron "0 * * * *" (every hour), **When** the current hour completes, **Then** the job is enqueued for execution
2. **Given** a recurring job completes successfully, **When** calculating the next run, **Then** nextRunAt is set based on the cron expression
3. **Given** a recurring job fails, **When** it eventually succeeds after retries, **Then** the next scheduled run uses the original cron timing

---

### User Story 5 - Graceful Shutdown (Priority: P2)

As a developer, I want to gracefully shutdown the scheduler so that in-progress jobs complete before the process exits.

**Why this priority**: Critical for production reliability but can be deferred for initial development and testing phases.

**Independent Test**: Can be tested by calling stop() while jobs are processing and verifying all in-progress jobs complete before the scheduler fully stops.

**Acceptance Scenarios**:

1. **Given** the scheduler is running with jobs in progress, **When** stop() is called, **Then** no new jobs are picked up for processing
2. **Given** stop() has been called, **When** all in-progress jobs complete, **Then** the stop() promise resolves
3. **Given** stop() has been called and timeout is configured, **When** jobs don't complete within timeout, **Then** the stop() promise resolves with a warning about incomplete jobs

---

### User Story 6 - Monitor Job Lifecycle Events (Priority: P2)

As a developer, I want to subscribe to job lifecycle events so that I can implement logging, alerting, and monitoring.

**Why this priority**: Essential for production observability but not required for core functionality to work.

**Independent Test**: Can be tested by subscribing to events and verifying correct events fire at each job lifecycle stage.

**Acceptance Scenarios**:

1. **Given** I subscribe to "job:start", **When** a job begins processing, **Then** I receive an event with job details
2. **Given** I subscribe to "job:complete", **When** a job finishes successfully, **Then** I receive an event with job details and duration
3. **Given** I subscribe to "job:fail", **When** a job fails, **Then** I receive an event with job details and error information
4. **Given** I subscribe to "job:error", **When** an unexpected error occurs during processing, **Then** I receive an event with error details

---

### User Story 7 - Use Decorators for Ts.ED Job Handlers (Priority: P3)

As a Ts.ED developer, I want to use decorators to define job handlers so that job registration follows framework conventions.

**Why this priority**: Framework-specific integration that adds developer convenience but is not required for core library functionality.

**Independent Test**: Can be tested by creating a class with @Job decorator and verifying it's automatically registered as a worker when the module loads.

**Acceptance Scenarios**:

1. **Given** a class decorated with `@Job({ name: "process-order" })`, **When** the Ts.ED application starts, **Then** the class is registered as a worker for "process-order" jobs
2. **Given** a job handler class with injected dependencies, **When** a job is processed, **Then** the handler has access to all injected services
3. **Given** multiple job handler classes in the application, **When** the application starts, **Then** all handlers are discovered and registered automatically

---

### User Story 8 - Configure Ts.ED Module with Different Connection Types (Priority: P3)

As a Ts.ED developer, I want to configure the Monque module with either Mongoose or native MongoDB so that I can integrate with my existing database setup.

**Why this priority**: Integration flexibility that supports different project setups but core functionality works with either approach.

**Independent Test**: Can be tested by configuring the module with each connection type and verifying jobs can be enqueued and processed.

**Acceptance Scenarios**:

1. **Given** a Ts.ED application using Mongoose, **When** I configure MonqueModule with the Mongoose connection, **Then** jobs are stored and retrieved correctly
2. **Given** a Ts.ED application using native MongoDB driver, **When** I configure MonqueModule with the native Db instance, **Then** jobs are stored and retrieved correctly
3. **Given** the module is configured, **When** the application starts, **Then** the scheduler begins polling for jobs automatically

---

### Edge Cases

- What happens when the database connection is lost during job processing?
  - Jobs in progress should continue until completion or failure; new job pickup is paused until reconnection
- How does the system handle when a job handler throws an unhandled exception?
  - The job should be marked as failed, failCount incremented, and scheduled for retry
- What happens when multiple scheduler instances try to lock the same job?
  - Atomic locking ensures only one instance can claim the job; others continue to the next available job
- How does the system handle jobs with extremely large data payloads?
  - Job data is limited to reasonable sizes (configurable max, default 16MB per MongoDB document limit)
- What happens when the cron expression is invalid?
  - Validation should occur at schedule time, throwing an error before the job is created
- How does the system handle clock drift between scheduler instances?
  - All instances use the database server's time for consistency via server-side timestamps
- What happens to permanently failed jobs?
  - Jobs exceeding max retries are retained with "failed" status indefinitely for inspection and debugging; no automatic cleanup (developers implement their own retention policies)

## Requirements *(mandatory)*

### Functional Requirements

**Core Package (`@monque/core`)**

- **FR-001**: System MUST support enqueueing one-off jobs via `enqueue<T>(name, data, options)` method
- **FR-002**: System MUST support a `uniqueKey` option to prevent duplicate pending/processing jobs
- **FR-003**: System MUST support scheduling recurring jobs via `schedule(cronExpression, name, data)` method
- **FR-004**: System MUST support registering job handlers via `worker(name, handler)` method
- **FR-005**: System MUST process jobs concurrently with configurable concurrency limit
- **FR-006**: System MUST implement atomic job locking using database operations
- **FR-007**: System MUST query jobs where status is "pending" and nextRunAt is at or before current time
- **FR-008**: System MUST set status to "processing" and lockedAt timestamp when locking a job
- **FR-009**: System MUST implement exponential backoff for failed jobs: `nextRunAt = now + (2^failCount × baseInterval)`
- **FR-010**: System MUST track failCount and failReason for each job failure
- **FR-011**: System MUST provide a `stop()` method that stops polling and waits for in-progress jobs
- **FR-012**: System MUST support configurable timeout for graceful shutdown
- **FR-013**: System MUST emit "job:start" event when a job begins processing
- **FR-014**: System MUST emit "job:complete" event when a job finishes successfully
- **FR-015**: System MUST emit "job:fail" event when a job fails
- **FR-016**: System MUST emit "job:error" event when an unexpected error occurs
- **FR-017**: System MUST mark jobs as permanently "failed" after reaching maximum retry attempts

**Framework Integration Package (`@monque/tsed`)**

- **FR-018**: System MUST provide a configurable module accepting connection configuration via dependency injection
- **FR-019**: System MUST support Mongoose Connection objects (extracting native .db handle)
- **FR-020**: System MUST support native MongoDB Db instances directly
- **FR-021**: System MUST provide a `@Job({ name: string, ... })` decorator for registering worker classes
- **FR-022**: System MUST provide full access to Ts.ED's DI container within job handler classes
- **FR-023**: System MUST auto-discover and register all decorated job handlers on application startup

### Key Entities

- **Job**: Represents a unit of work to be processed. Contains name (identifies handler), data (payload), status (lifecycle state), scheduling information (nextRunAt, repeatInterval), and failure tracking (failCount, failReason). May have a uniqueKey to prevent duplicates.

- **Worker**: A registered handler function or class that processes jobs of a specific name. Receives job data and executes the business logic.

- **Scheduler**: The orchestrating component that polls for pending jobs, manages locking, dispatches to workers, handles failures, and emits lifecycle events.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can enqueue and process a simple job in under 5 minutes from library installation
- **SC-002**: Jobs with unique keys correctly prevent duplicates 100% of the time (no race conditions)
- **SC-003**: Failed jobs retry automatically with correct exponential timing within 1% margin of calculated delay
- **SC-004**: Graceful shutdown completes all in-progress jobs within the configured timeout period
- **SC-005**: All job lifecycle events fire within 100ms of the corresponding state change
- **SC-006**: Multiple scheduler instances can process jobs concurrently without duplicate processing
- **SC-007**: Ts.ED developers can define a job handler with 3 lines of code (decorator + class + method)
- **SC-008**: Both Mongoose and native MongoDB connections work identically without code changes in job handlers

## Clarifications

### Session 2025-12-16

- Q: What should the default polling interval be for the scheduler to check for pending jobs? → A: 1 second (balanced responsiveness and efficiency)
- Q: What should happen to permanently failed jobs (those exceeding max retries)? → A: Retain with "failed" status indefinitely for inspection
- Q: Should the library support job isolation between different tenants/contexts sharing the same database? → A: No multi-tenancy; single namespace per database

## Assumptions

- MongoDB 4.0+ is used (required for atomic findAndModify operations)
- Node.js 18+ runtime environment
- Base retry interval defaults to 1 second (configurable)
- Default polling interval is 1 second (configurable) - balances job responsiveness with database load
- Default concurrency limit is 5 jobs per worker (configurable)
- Default graceful shutdown timeout is 30 seconds (configurable)
- No built-in multi-tenancy; single namespace per database (consumers can use separate databases or job name prefixes for isolation)
- Maximum retry attempts defaults to 10 (configurable)
- Jobs collection is named "monque_jobs" by default (configurable)
- Cron expressions follow standard 5-field format (minute, hour, day of month, month, day of week)
