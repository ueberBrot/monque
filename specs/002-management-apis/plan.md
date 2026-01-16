# Implementation Plan: Management APIs

**Branch**: `002-management-apis` | **Date**: 2026-01-16 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/002-management-apis/spec.md`

## Summary

Extend `@monque/core` with Management APIs enabling external tooling to manage jobs. Implements:
- **Single Job Management**: `cancelJob()`, `retryJob()`, `deleteJob()`
- **Bulk Job Management**: `cancelJobs()`, `retryJobs()`, `deleteJobs()` with filters
- **Cursor-Based Pagination**: `getJobsWithCursor()` with opaque cursors
- **Statistics & Aggregation**: `getQueueStats()` using MongoDB aggregation

No external utility libraries required—native MongoDB operations and base64 encoding suffice.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js ≥22  
**Primary Dependencies**: `mongodb ^7.0.0` (peer), `cron-parser ^5.4.0`  
**Storage**: MongoDB with existing indexes  
**Testing**: Vitest (unit + integration with testcontainers)  
**Target Platform**: Node.js server  
**Performance Goals**: Statistics on 100K+ jobs in <5s  
**Constraints**: Maintain backward compatibility; no breaking changes  
**Scale/Scope**: Single package modification (`@monque/core`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Compliant | Notes |
|-----------|-----------|-------|
| Type Safety First | ✅ | All new types use `interface`; no `any` |
| Strict Null Checks | ✅ | All nullable returns typed as `| null` |
| Interfaces Over Types | ✅ | `CursorPage`, `QueueStats`, `JobSelector` as interfaces |
| No Enums | ✅ | `cancelled` added to `JobStatus` const object |
| 100% Test Coverage | ✅ | Integration tests for all new methods |
| Event-Driven Design | ✅ | New events: `job:cancelled`, `job:retried`, `jobs:cancelled`, `jobs:retried` |
| Native Driver Usage | ✅ | Direct `findOneAndUpdate`, `updateMany`, aggregation |
| Graceful Degradation | ✅ | Null/false returns for non-existent jobs |
| Atomic Locking | ✅ | State transitions use `findOneAndUpdate` |
| Resilience Patterns | ✅ | Best-effort bulk operations with error collection |
| Living Documentation | ✅ | JSDoc + docs update in same PR |

## Project Structure

### Documentation (this feature)

```text
specs/002-management-apis/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (TypeScript interfaces)
└── tasks.md             # Phase 2 output (from /speckit.tasks)
```

### Source Code (repository root)

```text
packages/core/
├── src/
│   ├── index.ts              # Export new types and methods
│   ├── events/
│   │   └── types.ts          # Add job:cancelled, job:retried events
│   ├── jobs/
│   │   ├── types.ts          # Add 'cancelled' to JobStatus, new filter types
│   │   └── guards.ts         # Add isCancelledJob() guard
│   ├── scheduler/
│   │   └── monque.ts         # New management methods
│   └── shared/
│       └── errors.ts         # Add JobStateError
└── tests/
    └── integration/
        ├── management.test.ts     # Single job operations
        ├── bulk-management.test.ts # Bulk operations
        ├── cursor-pagination.test.ts # Cursor-based pagination
        └── statistics.test.ts     # Queue statistics
```

## Required Indexes

The following indexes support efficient filtering for bulk operations and pagination:

| Index | Fields | Purpose |
|-------|--------|--------|
| Existing | `{ name: 1, status: 1 }` | Filter by job name and status |
| Existing | `{ _id: 1 }` | Cursor pagination (default) |
| Recommended | `{ createdAt: 1 }` | Date range filtering (`olderThan`, `newerThan`) |

## Proposed Changes

### Jobs Module

#### [MODIFY] [types.ts](../../packages/core/src/jobs/types.ts)

1. **Add `cancelled` to `JobStatus`**:
   ```typescript
   export const JobStatus = {
     PENDING: 'pending',
     PROCESSING: 'processing',
     COMPLETED: 'completed',
     FAILED: 'failed',
     CANCELLED: 'cancelled', // NEW
   } as const;
   ```

2. **Add `CursorDirection` const**:
   ```typescript
   export const CursorDirection = {
     FORWARD: 'forward',
     BACKWARD: 'backward',
   } as const;
   ```

3. **Add `JobSelector` interface** for bulk operations:
   ```typescript
   export interface JobSelector {
     name?: string;
     status?: JobStatusType | JobStatusType[];
     olderThan?: Date;
     newerThan?: Date;
   }
   ```

4. **Add `CursorOptions` interface**:
   ```typescript
   export interface CursorOptions {
     cursor?: string;
     limit?: number;
     direction?: CursorDirectionType;
     filter?: Pick<GetJobsFilter, 'name' | 'status'>;
   }
   ```

5. **Add `CursorPage` interface**:
   ```typescript
   export interface CursorPage<T = unknown> {
     jobs: PersistedJob<T>[];
     cursor: string | null;
     hasNextPage: boolean;
     hasPreviousPage: boolean;
   }
   ```

6. **Add `QueueStats` interface**:
   ```typescript
   export interface QueueStats {
     pending: number;
     processing: number;
     completed: number;
     failed: number;
     cancelled: number;
     total: number;
     avgProcessingDurationMs?: number;
   }
   ```

7. **Add `BulkOperationResult` interface**:
   ```typescript
   export interface BulkOperationResult {
     count: number;
     errors: Array<{ jobId: string; error: string }>;
   }
   ```

---

#### [MODIFY] [guards.ts](../../packages/core/src/jobs/guards.ts)

Add type guard for cancelled jobs:
```typescript
export function isCancelledJob<T>(job: Job<T>): boolean {
  return job.status === JobStatus.CANCELLED;
}
```

---

### Events Module

#### [MODIFY] [types.ts](../../packages/core/src/events/types.ts)

Add new events to `MonqueEventMap`:
```typescript
// Single job events
'job:cancelled': {
  job: Job;
};

'job:retried': {
  job: Job;
  previousStatus: 'failed' | 'cancelled';
};

'job:deleted': {
  jobId: ObjectId;
};

// Bulk operation summary events
'jobs:cancelled': {
  jobIds: ObjectId[];
  count: number;
};

'jobs:retried': {
  jobIds: ObjectId[];
  count: number;
};
```

---

### Shared Module

#### [MODIFY] [errors.ts](../../packages/core/src/shared/errors.ts)

Add error for invalid state transitions:
```typescript
export class JobStateError extends MonqueError {
  constructor(
    message: string,
    public readonly jobId: string,
    public readonly currentStatus: string,
    public readonly attemptedAction: 'cancel' | 'retry' | 'delete',
  ) {
    super(message);
    this.name = 'JobStateError';
  }
}
```

Add error for invalid/expired cursors:
```typescript
export class InvalidCursorError extends MonqueError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCursorError';
  }
}
```

Add error for aggregation timeout:
```typescript
export class AggregationTimeoutError extends MonqueError {
  constructor(message: string = 'Statistics aggregation exceeded 30 second timeout') {
    super(message);
    this.name = 'AggregationTimeoutError';
  }
}

---

### Scheduler Module

#### [MODIFY] [monque.ts](../../packages/core/src/scheduler/monque.ts)

Add 9 new public methods to `Monque` class:

**Single Job Operations:**
```typescript
async cancelJob(id: ObjectId): Promise<PersistedJob | null>
async retryJob(id: ObjectId): Promise<PersistedJob | null>
async rescheduleJob(id: ObjectId, runAt: Date): Promise<PersistedJob | null>
async deleteJob(id: ObjectId): Promise<boolean>
```

**Bulk Operations:**
```typescript
async cancelJobs(filter: JobSelector): Promise<BulkOperationResult>
async retryJobs(filter: JobSelector): Promise<BulkOperationResult>
async deleteJobs(filter: JobSelector): Promise<BulkOperationResult>
```

> Bulk operations use `bulkWrite` with 1000-document batches for memory efficiency.

**Pagination & Statistics:**
```typescript
async getJobsWithCursor<T>(options?: CursorOptions): Promise<CursorPage<T>>
async getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats>
```

**Private Helpers:**
```typescript
private buildSelectorQuery(filter: JobSelector): Filter<Document>
private encodeCursor(id: ObjectId, direction: CursorDirectionType): string  // Encodes 'F' or 'B' prefix + base64url ObjectId
private decodeCursor(cursor: string): { id: ObjectId; direction: CursorDirectionType }  // O(1) decode, no DB query
```

---

### Exports

#### [MODIFY] [index.ts](../../packages/core/src/index.ts)

Export new types:
```typescript
export type {
  JobSelector,
  CursorOptions,
  CursorPage,
  QueueStats,
  BulkOperationResult,
} from '@/jobs';

export {
  CursorDirection,
  isCancelledJob,
} from '@/jobs';

export {
  JobStateError,
  InvalidCursorError,
  AggregationTimeoutError,
} from '@/shared';
```

---

### Tests

#### [NEW] `tests/integration/management.test.ts`

Single job management integration tests:
- `cancelJob()` on pending job → status becomes cancelled, event emitted
- `cancelJob()` on processing job → error (cannot cancel while processing)
- `cancelJob()` on already cancelled job → idempotent success
- `cancelJob()` on non-existent job → returns null
- `retryJob()` on failed job → status becomes pending, failCount resets
- `retryJob()` on cancelled job → status becomes pending
- `retryJob()` on pending/processing job → error
- `rescheduleJob()` on pending job → nextRunAt updated, job returned
- `rescheduleJob()` on processing/completed/failed job → error (wrong state)
- `rescheduleJob()` on non-existent job → returns null
- `deleteJob()` on any job → document removed, returns true
- `deleteJob()` on non-existent job → returns false

#### [NEW] `tests/integration/bulk-management.test.ts`

Bulk operation integration tests:
- `cancelJobs({ name: 'x', status: 'pending' })` → all matching cancelled
- `cancelJobs()` skips processing jobs, includes them in errors
- `retryJobs({ status: 'failed' })` → all matching become pending
- `deleteJobs({ status: 'completed', olderThan: Date })` → removed
- Empty filter matches no jobs → count 0, no errors

#### [NEW] `tests/integration/cursor-pagination.test.ts`

Cursor-based pagination integration tests:
- First page returns jobs + cursor + hasNextPage
- Subsequent pages with cursor continue correctly
- Forward/backward pagination
- Jobs added during pagination appear correctly
- Jobs deleted during pagination don't break cursor
- Invalid cursor returns `InvalidCursorError`
- Large dataset (1000+ jobs) handles efficiently

#### [NEW] `tests/integration/statistics.test.ts`

Queue statistics integration tests:
- Empty queue returns zero counts
- Mixed status jobs return correct counts
- Filter by name scopes statistics
- Average processing duration calculated correctly
- Performance: 100K jobs returns in <5s

---

## Verification Plan

### Automated Tests

All tests use the existing Vitest + testcontainers setup with a real MongoDB instance.

**Run all new management tests:**
```bash
cd packages/core && bun run test:integration -- management
```

**Run full integration suite to ensure no regressions:**
```bash
cd packages/core && bun run test:integration
```

**Run unit tests:**
```bash
cd packages/core && bun run test:unit
```

**Run full test suite with coverage:**
```bash
bun run test:coverage
```

### Manual Verification

> [!NOTE]
> Manual verification is optional for this feature since all acceptance criteria from the spec have corresponding automated integration tests.

If desired, manual verification steps:
1. Build the package: `cd packages/core && bun run build`
2. Check exports: `cd packages/core && bun run check:exports`
3. Verify TypeScript types compile: `cd packages/core && bun run type-check`

---

## Complexity Tracking

No constitution violations. All patterns follow established conventions in the codebase.
