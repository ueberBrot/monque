# Quickstart: Management APIs

This guide demonstrates the new Management APIs in `@monque/core` v1.1.0.

## Prerequisites

```typescript
import { Monque, JobStatus } from '@monque/core';
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();
const db = client.db('myapp');

const monque = new Monque(db);
await monque.initialize();
monque.start();
```

---

## Single Job Management

### Cancel a Pending Job

```typescript
// Get a job ID string (from events, API, or query)
const jobId = '507f1f77bcf86cd799439011';

// Cancel the job
const cancelledJob = await monque.cancelJob(jobId);

if (cancelledJob) {
  console.log(`Job ${cancelledJob._id} cancelled`);
} else {
  console.log('Job not found or not in cancellable state');
}

// Listen for cancellation events
monque.on('job:cancelled', ({ job }) => {
  console.log(`Job ${job.name} was cancelled`);
});
```

### Retry a Failed Job

```typescript
// Retry a failed or cancelled job
const retriedJob = await monque.retryJob(jobId);

if (retriedJob) {
  console.log(`Job ${retriedJob._id} queued for retry`);
  console.log(`Previous status was: failed or cancelled`);
}

// Listen for retry events
monque.on('job:retried', ({ job, previousStatus }) => {
  console.log(`Job ${job.name} retried from ${previousStatus}`);
});
```

### Delete a Job

```typescript
// Delete any job (regardless of status)
const deleted = await monque.deleteJob(jobId);

if (deleted) {
  console.log('Job deleted');
} else {
  console.log('Job not found');
}
```

### Reschedule a Pending Job

```typescript
// Delay a job by 1 hour
const oneHourLater = new Date(Date.now() + 60 * 60 * 1000);
const rescheduledJob = await monque.rescheduleJob(jobId, oneHourLater);

if (rescheduledJob) {
  console.log(`Job rescheduled to ${rescheduledJob.nextRunAt}`);
} else {
  console.log('Job not found or not in pending state');
}

// Run a pending job immediately
const runNow = await monque.rescheduleJob(jobId, new Date());
```

---

## Bulk Job Management

### Cancel Multiple Jobs

```typescript
// Cancel all pending jobs of a specific type
const result = await monque.cancelJobs({
  name: 'email-sync',
  status: JobStatus.PENDING,
});

console.log(`Cancelled ${result.count} jobs`);

if (result.errors.length > 0) {
  console.error('Some jobs could not be cancelled:');
  result.errors.forEach(({ jobId, error }) => {
    console.error(`  - ${jobId}: ${error}`);
  });
}
```

### Retry Multiple Jobs

```typescript
// Retry all failed jobs
const retryResult = await monque.retryJobs({
  status: JobStatus.FAILED,
});

console.log(`Queued ${retryResult.count} jobs for retry`);
```

### Delete Old Jobs

```typescript
// Delete completed jobs older than 7 days
const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const result = await monque.deleteJobs({
  status: JobStatus.COMPLETED,
  olderThan: weekAgo,
});

console.log(`Deleted ${result.count} old completed jobs`);
```

---

## Cursor-Based Pagination

### Paginate Through Jobs

```typescript
// First page
const page1 = await monque.getJobsWithCursor({ limit: 50 });

console.log(`Page 1: ${page1.jobs.length} jobs`);
console.log(`Has next page: ${page1.hasNextPage}`);

// Continue with cursor
if (page1.hasNextPage && page1.cursor) {
  const page2 = await monque.getJobsWithCursor({
    cursor: page1.cursor,
    limit: 50,
  });
  
  console.log(`Page 2: ${page2.jobs.length} jobs`);
}
```

### Paginate with Filters

```typescript
// Paginate only failed email jobs
const failedEmails = await monque.getJobsWithCursor({
  limit: 20,
  filter: {
    name: 'send-email',
    status: JobStatus.FAILED,
  },
});
```

### Backward Pagination

```typescript
import { CursorDirection } from '@monque/core';

// Go back to previous page
const previousPage = await monque.getJobsWithCursor({
  cursor: currentCursor,
  direction: CursorDirection.BACKWARD,
  limit: 50,
});
```

---

## Queue Statistics

### Get Overall Stats

```typescript
const stats = await monque.getQueueStats();

console.log(`Queue Overview:
  Total:      ${stats.total}
  Pending:    ${stats.pending}
  Processing: ${stats.processing}
  Completed:  ${stats.completed}
  Failed:     ${stats.failed}
  Cancelled:  ${stats.cancelled}
`);

if (stats.avgProcessingDurationMs) {
  console.log(`Avg processing time: ${stats.avgProcessingDurationMs}ms`);
}
```

### Get Stats for Specific Job Type

```typescript
// Stats for email jobs only
const emailStats = await monque.getQueueStats({ name: 'send-email' });

console.log(`Email jobs: ${emailStats.total} total, ${emailStats.failed} failed`);
```

---

## Error Handling

```typescript
import { 
  JobStateError, 
  InvalidCursorError,
  ConnectionError 
} from '@monque/core';

try {
  await monque.cancelJob(processingJobId);
} catch (error) {
  if (error instanceof JobStateError) {
    console.error(`Cannot ${error.attemptedAction} job in ${error.currentStatus} state`);
  }
}

try {
  await monque.getJobsWithCursor({ cursor: 'invalid-cursor' });
} catch (error) {
  if (error instanceof InvalidCursorError) {
    // Cursor expired or invalid, restart from beginning
    await monque.getJobsWithCursor({ limit: 50 });
  }
}
```

---

## Dashboard Integration Example

A complete example showing how to build a simple job dashboard API:

```typescript
import express from 'express';
import { Monque, JobStatus, JobStateError } from '@monque/core';

const app = express();
app.use(express.json());

// GET /api/jobs?cursor=xxx&limit=50&status=failed
app.get('/api/jobs', async (req, res) => {
  const { cursor, limit = '50', status } = req.query;
  
  const page = await monque.getJobsWithCursor({
    cursor: cursor as string | undefined,
    limit: parseInt(limit as string, 10),
    filter: status ? { status: status as string } : undefined,
  });
  
  res.json(page);
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  const stats = await monque.getQueueStats();
  res.json(stats);
});

// POST /api/jobs/:id/cancel
app.post('/api/jobs/:id/cancel', async (req, res) => {
  try {
    const job = await monque.cancelJob(req.params.id);
    if (job) {
      res.json({ success: true, job });
    } else {
      res.status(404).json({ error: 'Job not found' });
    }
  } catch (error) {
    if (error instanceof JobStateError) {
      res.status(400).json({ error: error.message });
    } else {
      throw error;
    }
  }
});

// POST /api/jobs/:id/retry
app.post('/api/jobs/:id/retry', async (req, res) => {
  try {
    const job = await monque.retryJob(req.params.id);
    if (job) {
      res.json({ success: true, job });
    } else {
      res.status(404).json({ error: 'Job not found' });
    }
  } catch (error) {
    if (error instanceof JobStateError) {
      res.status(400).json({ error: error.message });
    } else {
      throw error;
    }
  }
});

// DELETE /api/jobs/:id
app.delete('/api/jobs/:id', async (req, res) => {
  const deleted = await monque.deleteJob(req.params.id);
  res.json({ success: deleted });
});

// POST /api/jobs/bulk/cleanup
app.post('/api/jobs/bulk/cleanup', async (req, res) => {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const deleted = await monque.deleteJobs({
    status: [JobStatus.COMPLETED, JobStatus.CANCELLED],
    olderThan: weekAgo,
  });
  
  res.json({ deleted });
});

app.listen(3000);
```
