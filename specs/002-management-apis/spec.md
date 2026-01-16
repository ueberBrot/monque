# Feature Specification: Management APIs

**Feature Branch**: `002-management-apis`  
**Created**: 2026-01-15  
**Status**: Draft  
**Target Release**: v1.1.0 – "The Management Release"  
**Input**: User description: "The foundational APIs of @monque/core needs to be extended for external tooling. Job Management APIs: Single & Bulk operations (cancel, retry, delete). Stable Cursor Pagination for scalable list queries. Statistics & Aggregation APIs."

## Clarifications

### Session 2026-01-15

- Q: Who is authorized to invoke management APIs? → A: No authorization in core; consuming app handles access control.
- Q: What happens if a bulk operation fails partway through? → A: Best-effort execution; continue processing, return count + list of errors.
- Q: What is "reasonable time" for statistics on 100K+ jobs? → A: Under 5 seconds.
- Q: Should bulk operations have safeguards for large result sets? → A: No artificial limits; process all matching jobs.
- Q: Should spec include a formal job state lifecycle diagram? → A: Not needed in spec; defer to planning phase.

## User Scenarios & Testing

### User Story 1 - Single Job Management (Priority: P1)

An operator or API consumer views job details and needs to take action on an individual job—cancelling a stuck job, retrying a failed one, or deleting an obsolete job.

**Why this priority**: Single-job operations are the most fundamental management capability. Without them, operators cannot recover from failures or clean up bad data. This is the minimum viable management API.

**Independent Test**: Can be fully tested by creating jobs in various states, calling the management methods, and verifying state transitions and event emissions.

**Acceptance Scenarios**:

1. **Given** a pending job exists, **When** the operator calls `cancelJob(id)`, **Then** the job status transitions to `cancelled` and a `job:cancelled` event is emitted.
2. **Given** a failed job exists, **When** the operator calls `retryJob(id)`, **Then** the job status transitions to `pending`, `failCount` resets to 0, and a `job:retried` event is emitted.
3. **Given** a completed job exists, **When** the operator calls `deleteJob(id)`, **Then** the job document is removed from the collection.
4. **Given** a processing job exists, **When** the operator calls `cancelJob(id)`, **Then** the operation fails with an error indicating the job cannot be cancelled while actively processing.
5. **Given** a job ID that does not exist, **When** the operator calls any management method, **Then** `null` or `false` is returned to indicate no action was taken.

---

### User Story 2 - Cursor-Based Pagination (Priority: P2)

An API consumer needs to paginate through potentially thousands of jobs efficiently without missing or duplicating records when jobs are added or removed during pagination.

**Why this priority**: Listing jobs is core to external tooling. Skip/limit pagination breaks down at scale and under concurrent writes. Cursor-based pagination enables stable iteration.

**Independent Test**: Can be tested by inserting jobs, paginating with cursors, adding/removing jobs mid-pagination, and verifying no records are missed or duplicated.

**Acceptance Scenarios**:

1. **Given** 150 jobs exist, **When** the consumer queries with `getJobsWithCursor({ limit: 50 })`, **Then** the first 50 jobs are returned along with a cursor pointing to the next batch.
2. **Given** a cursor from a previous query, **When** the consumer passes it to `getJobsWithCursor({ cursor, limit: 50 })`, **Then** the next 50 jobs are returned without duplicates.
3. **Given** new jobs are inserted during pagination, **When** the consumer continues with the same cursor direction, **Then** new jobs are appended naturally without disrupting the current page sequence.
4. **Given** jobs are deleted during pagination, **When** the consumer resumes with a cursor, **Then** no errors occur and pagination continues from the stable cursor position.
5. **Given** an invalid or malformed cursor (e.g., non-base64, references a deleted job, schema version mismatch), **When** the consumer calls the method, **Then** an `InvalidCursorError` is returned. Note: Cursors do not expire by time; they become invalid only if the referenced `_id` no longer exists or cursor format is invalid.
6. **Given** 100 jobs exist, **When** the consumer queries with `getJobsWithCursor({ direction: 'backward', limit: 20 })` without a cursor, **Then** the 20 newest jobs are returned with `hasNextPage: true` (older jobs exist).
7. **Given** a backward cursor, **When** the consumer continues pagination, **Then** older jobs are returned and `hasPreviousPage` indicates newer jobs exist.

---

### User Story 3 - Bulk Job Management (Priority: P3)

An operator needs to manage multiple jobs simultaneously—cancelling all pending jobs of a certain type, retrying all failed jobs from today, or deleting completed jobs older than a threshold.

**Why this priority**: Bulk operations significantly improve operator efficiency when dealing with job backlogs or cleanup tasks. Builds on single-job operations (P1).

**Independent Test**: Can be tested by creating multiple jobs matching various criteria, executing bulk operations, and verifying all matching jobs are affected correctly.

**Acceptance Scenarios**:

1. **Given** 20 pending jobs exist with name `email-sync`, **When** the operator calls `cancelJobs({ name: 'email-sync', status: 'pending' })`, **Then** all 20 jobs transition to `cancelled` and the method returns `{ count: 20, errors: [] }`.
2. **Given** 5 failed jobs exist, **When** the operator calls `retryJobs({ status: 'failed' })`, **Then** all 5 jobs transition to `pending` with `failCount` reset and the method returns `{ count: 5, errors: [] }`.
3. **Given** 50 completed jobs older than 7 days exist, **When** the operator calls `deleteJobs({ status: 'completed', olderThan: Date })`, **Then** all 50 jobs are deleted and the method returns `{ count: 50, errors: [] }`.
4. **Given** a filter that matches no jobs, **When** a bulk operation is called, **Then** the method returns `{ count: 0, errors: [] }`.
5. **Given** 12 jobs match a filter where 10 can be cancelled and 2 are in `processing` status, **When** `cancelJobs(filter)` is called, **Then** the method returns `{ count: 10, errors: [{ jobId: '...', error: 'Cannot cancel job in processing state' }, ...] }` and a `jobs:cancelled` event is emitted with the 10 successful IDs.

---

### User Story 4 - Queue Statistics (Priority: P4)

External tooling displays aggregate metrics for the job queue—total counts by status, processing rates, failure rates, and average processing times.

**Why this priority**: Statistics enable operators to view meaningful KPIs and understand queue health at a glance. Depends on stable job state data.

**Independent Test**: Can be tested by creating jobs in known states, calling statistics methods, and verifying returned aggregates match expected values.

**Acceptance Scenarios**:

1. **Given** jobs exist in various statuses, **When** the operator calls `getQueueStats()`, **Then** the response includes counts for each status (pending, processing, completed, failed, cancelled).
2. **Given** completed jobs with varied processing durations, **When** the operator calls `getQueueStats()`, **Then** average processing time (`avgProcessingDurationMs`) is included.
3. **Given** a filter for specific job name, **When** the operator calls `getQueueStats({ name: 'sync-user' })`, **Then** statistics are scoped to that job type only.
4. **Given** no jobs exist, **When** `getQueueStats()` is called, **Then** zero counts are returned without errors.

---

### Edge Cases

- What happens when `cancelJob` is called on an already-cancelled job? (Idempotent: return success without modification)
- What happens when `retryJob` is called on a pending or processing job? (Error: `JobStateError` with `currentStatus: 'processing'` or `'pending'`)
- What happens when cursor pagination is used with a changed sort order between requests? (Error or stale cursor warning)
- How are recurring jobs handled with `deleteJob`? (Deleted normally; no special handling for recurrence)
- What happens when `deleteJobs` filter is too broad (matches thousands)? (Accept with batch processing internally using 1000-doc batches; no artificial limits)
- Authorization/access control: The core library does NOT enforce authorization; consuming applications are responsible for access control before invoking management APIs.
- What happens when two operators cancel the same job concurrently? (Atomic `findOneAndUpdate`; first wins, second returns `null`)
- What happens when `olderThan` and `newerThan` create an impossible date range? (Return empty result; no matching jobs, no error)
- What happens when `rescheduleJob` is called with a `runAt` date in the past? (Allowed; job runs immediately on next poll cycle)
- What happens if statistics aggregation exceeds 30 seconds? (Throw `AggregationTimeoutError`)
- What happens when switching pagination direction mid-stream? (Not supported; start new pagination with new direction)

## Requirements

### Functional Requirements

#### Single Job Management

- **FR-001**: System MUST provide `cancelJob(id)` method that transitions a job from `pending` to `cancelled` status.
- **FR-002**: System MUST prevent cancellation of jobs in `processing` status, returning an error.
- **FR-003**: System MUST provide `retryJob(id)` method that transitions a job from `failed` or `cancelled` to `pending` status with `failCount` reset.
- **FR-004**: System MUST prevent retry of jobs not in `failed` or `cancelled` status.
- **FR-004a**: System MUST provide `rescheduleJob(id, runAt)` method that updates the `nextRunAt` field for a `pending` job.
- **FR-004b**: System MUST prevent rescheduling jobs not in `pending` status, returning an error.
- **FR-005**: System MUST provide `deleteJob(id)` method that removes a job document from the collection.
- **FR-005a**: System MAY emit `job:deleted` event when a job is successfully deleted.
- **FR-006**: System MUST emit `job:cancelled` event when a job is successfully cancelled.
- **FR-007**: System MUST emit `job:retried` event when a job is successfully retried.

#### Bulk Job Management

- **FR-008**: System MUST provide `cancelJobs(filter)` method that transitions multiple matching jobs to `cancelled` status.
- **FR-008a**: Bulk cancel MUST emit `jobs:cancelled` event with list of affected job IDs.
- **FR-009**: System MUST provide `retryJobs(filter)` method that transitions multiple matching jobs to `pending` status.
- **FR-009a**: Bulk retry MUST emit `jobs:retried` event with list of affected job IDs.
- **FR-010**: System MUST provide `deleteJobs(filter)` method that removes multiple matching job documents.
- **FR-011**: Bulk methods MUST return `BulkOperationResult` containing `count` and `errors` array.
- **FR-012**: Bulk cancellation MUST skip jobs in `processing` status.
- **FR-012a**: Bulk operations MUST use best-effort execution: continue processing on individual job errors and return a result containing the success count and any errors encountered.
- **FR-012b**: Bulk operations use streaming with 1000-document batches; peak memory MUST remain under 50MB for 100K jobs.

#### Cursor-Based Pagination

- **FR-013**: System MUST provide `getJobsWithCursor(options)` method returning jobs with an opaque cursor.
- **FR-014**: Cursor MUST encode position based on `_id` as the stable sort key (guaranteed unique and monotonic).
- **FR-015**: System MUST support forward and backward pagination via cursor direction.
- **FR-015a**: Backward pagination without cursor MUST start from newest job.
- **FR-015b**: In backward mode, `hasNextPage` indicates older jobs exist; `hasPreviousPage` indicates newer jobs exist.
- **FR-015c**: Cursor encodes direction as first byte: `F` (forward) or `B` (backward).
- **FR-015d**: Switching direction mid-pagination is not supported; consumers must start new pagination.
- **FR-016**: System MUST return `hasNextPage` and `hasPreviousPage` indicators.
- **FR-017**: System MUST decode and validate cursors, returning `InvalidCursorError` for malformed, deleted reference, or schema version mismatch.
- **FR-017a**: Cursor decode MUST be O(1) constant time with no database query.

#### Statistics & Aggregation

- **FR-018**: System MUST provide `getQueueStats(filter?)` method returning aggregate job metrics.
- **FR-019**: Statistics MUST include count per status (pending, processing, completed, failed, cancelled).
- **FR-020**: Statistics MUST include total job count and completed job count.
- **FR-021**: Statistics MAY include average processing duration for completed jobs.
- **FR-022**: Statistics MUST support filtering by job name.

### Key Entities

- **Job**: Extended with `cancelled` status value in the `JobStatus` enum.
- **CursorPage**: New response type containing `jobs`, `cursor`, `hasNextPage`, `hasPreviousPage`.
- **QueueStats**: New response type containing status counts, totals, and `avgProcessingDurationMs` (arithmetic mean of `completedAt - startedAt`).
- **JobSelector**: Filter type for bulk operations including `name`, `status` (`'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'`), `olderThan`, `newerThan`.
- **BulkOperationResult**: Response type containing `count: number` and `errors: Array<{ jobId: string; error: string }>`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Operators can manage individual jobs (cancel, retry, delete) with a single action per job.
- **SC-002**: API consumers can paginate through 100,000+ jobs without experiencing duplicate or missing entries.
- **SC-003**: Bulk operations can process 1,000+ matching jobs in a single call.
- **SC-004**: Queue statistics can aggregate data from 100,000+ jobs and return within 5 seconds.
- **SC-005**: All management operations emit appropriate events: single ops emit `job:cancelled`, `job:retried`, `job:deleted`; bulk ops emit `jobs:cancelled`, `jobs:retried`.
- **SC-006**: Existing functionality (enqueue, schedule, worker processing) remains unaffected.
- **SC-007**: No artificial concurrency limits on bulk operations; consuming application controls concurrency.
