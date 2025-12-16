# Data Model: Monque Job Scheduler

**Feature**: 001-monque-scheduler  
**Date**: 2025-12-16  
**Status**: Complete

## Entities

### Job

The primary entity representing a unit of work to be processed.

| Field            | Type           | Required | Description                                      |
| ---------------- | -------------- | -------- | ------------------------------------------------ |
| `_id`            | `ObjectId`     | Auto     | MongoDB document identifier                      |
| `name`           | `string`       | Yes      | Job type identifier, matches worker registration |
| `data`           | `T` (generic)  | Yes      | Job payload, JSON-serializable data              |
| `status`         | `JobStatus`    | Yes      | Current lifecycle state                          |
| `nextRunAt`      | `Date`         | Yes      | When the job should be processed                 |
| `lockedAt`       | `Date \| null` | No       | Timestamp when job was locked for processing     |
| `failCount`      | `number`       | Yes      | Number of failed attempts (default: 0)           |
| `failReason`     | `string`       | No       | Last failure error message                       |
| `repeatInterval` | `string`       | No       | Cron expression for recurring jobs               |
| `uniqueKey`      | `string`       | No       | Deduplication key to prevent duplicate jobs      |
| `createdAt`      | `Date`         | Yes      | Job creation timestamp                           |
| `updatedAt`      | `Date`         | Yes      | Last modification timestamp                      |

### JobStatus (Value Object)

Enumeration of job lifecycle states using `as const` pattern.

| Value        | Description                                 |
| ------------ | ------------------------------------------- |
| `pending`    | Job is waiting to be processed              |
| `processing` | Job is currently being executed by a worker |
| `completed`  | Job finished successfully                   |
| `failed`     | Job permanently failed after max retries    |

## State Transitions

```
                    ┌─────────────┐
                    │   pending   │
                    └──────┬──────┘
                           │ worker picks up job
                           │ (atomic lock)
                           ▼
                    ┌─────────────┐
              ┌─────│ processing  │─────┐
              │     └─────────────┘     │
              │                         │
        success │                       │ failure
              │                         │
              ▼                         ▼
       ┌─────────────┐          ┌──────────────┐
       │  completed  │          │ failCount++  │
       └─────────────┘          └──────┬───────┘
                                       │
                          ┌────────────┴────────────┐
                          │                         │
                failCount < maxRetries     failCount >= maxRetries
                          │                         │
                          ▼                         ▼
                   ┌─────────────┐           ┌─────────────┐
                   │   pending   │           │   failed    │
                   │ (backoff)   │           │ (permanent) │
                   └─────────────┘           └─────────────┘
```

## Validation Rules

### Job Creation

1. `name` must be a non-empty string
2. `data` must be JSON-serializable (respects MongoDB 16MB document limit)
3. `status` must be one of the defined `JobStatus` values
4. `nextRunAt` must be a valid Date
5. `failCount` must be >= 0
6. `repeatInterval` if provided, must be a valid 5-field cron expression
7. `uniqueKey` if provided, must be a non-empty string

### UniqueKey Constraints

When `uniqueKey` is provided:
- Only one job with the same `uniqueKey` can exist in `pending` or `processing` status
- `completed` jobs do not block new jobs with the same `uniqueKey`
- Implemented via upsert: `updateOne({ uniqueKey, status: { $in: ['pending', 'processing'] } }, { $setOnInsert: ... }, { upsert: true })`

## Indexes

```javascript
// Primary query index for job pickup
{ status: 1, nextRunAt: 1 }

// Unique constraint for deduplication
{ uniqueKey: 1, status: 1 }  // Partial index where uniqueKey exists and status in ['pending', 'processing']

// Optional: for job lookup by name
{ name: 1, status: 1 }
```

## Relationships

```
┌──────────────────┐         ┌──────────────────┐
│      Worker      │ 1:N     │       Job        │
│                  │─────────│                  │
│  - name: string  │         │  - name: string  │
│  - handler: fn   │         │  - status        │
│  - concurrency   │         │  - data          │
└──────────────────┘         └──────────────────┘
        │
        │ processes
        ▼
┌──────────────────┐
│    Scheduler     │
│                  │
│  - workers: Map  │
│  - polling loop  │
│  - activeJobs    │
└──────────────────┘
```

## MongoDB Collection Configuration

**Collection name**: `monque_jobs` (default, configurable)

**Storage engine**: WiredTiger (default)

**Write concern**: Majority (recommended for production)

**Read concern**: Local (default, sufficient for job processing)

## Sample Documents

### One-off Job (Pending)

```json
{
  "_id": { "$oid": "6760a1234567890abcdef123" },
  "name": "send-email",
  "data": {
    "to": "user@example.com",
    "subject": "Welcome!",
    "template": "welcome"
  },
  "status": "pending",
  "nextRunAt": { "$date": "2025-12-16T10:30:00.000Z" },
  "lockedAt": null,
  "failCount": 0,
  "createdAt": { "$date": "2025-12-16T10:29:55.000Z" },
  "updatedAt": { "$date": "2025-12-16T10:29:55.000Z" }
}
```

### Recurring Job (With Cron)

```json
{
  "_id": { "$oid": "6760a1234567890abcdef456" },
  "name": "daily-report",
  "data": { "reportType": "sales" },
  "status": "pending",
  "nextRunAt": { "$date": "2025-12-17T00:00:00.000Z" },
  "lockedAt": null,
  "failCount": 0,
  "repeatInterval": "0 0 * * *",
  "createdAt": { "$date": "2025-12-16T08:00:00.000Z" },
  "updatedAt": { "$date": "2025-12-16T08:00:00.000Z" }
}
```

### Job With UniqueKey (Processing)

```json
{
  "_id": { "$oid": "6760a1234567890abcdef789" },
  "name": "sync-user",
  "data": { "userId": "user-123" },
  "status": "processing",
  "nextRunAt": { "$date": "2025-12-16T10:30:00.000Z" },
  "lockedAt": { "$date": "2025-12-16T10:30:01.000Z" },
  "failCount": 0,
  "uniqueKey": "sync-user-123",
  "createdAt": { "$date": "2025-12-16T10:29:50.000Z" },
  "updatedAt": { "$date": "2025-12-16T10:30:01.000Z" }
}
```

### Failed Job (After Retries)

```json
{
  "_id": { "$oid": "6760a1234567890abcdefabc" },
  "name": "process-payment",
  "data": { "orderId": "order-456", "amount": 99.99 },
  "status": "failed",
  "nextRunAt": { "$date": "2025-12-16T11:00:00.000Z" },
  "lockedAt": null,
  "failCount": 10,
  "failReason": "Payment gateway timeout after 10 attempts",
  "createdAt": { "$date": "2025-12-16T09:00:00.000Z" },
  "updatedAt": { "$date": "2025-12-16T11:00:00.000Z" }
}
```
