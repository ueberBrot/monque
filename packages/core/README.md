<p align="center">
  <img src="../../assets/logo.svg" width="180" alt="Monque logo" />
</p>

<h1 align="center">@monque/core</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@monque/core">
    <img src="https://img.shields.io/npm/v/%40monque%2Fcore?style=for-the-badge&label=%40monque%2Fcore" alt="@monque/core version" />
  </a>
  <a href="https://codecov.io/gh/ueberBrot/monque">
    <img src="https://img.shields.io/codecov/c/github/ueberBrot/monque?style=for-the-badge&logo=codecov&logoColor=white" alt="Codecov" />
  </a>
</p>

<p align="center">MongoDB-backed job scheduler with atomic locking, exponential backoff, and cron scheduling.</p>

## Installation

Using Bun:
```bash
bun add @monque/core mongodb
```

Or using npm/yarn/pnpm:
```bash
npm install @monque/core mongodb
yarn add @monque/core mongodb
pnpm add @monque/core mongodb
```

## Usage

```typescript
import { Monque } from '@monque/core';
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();

const monque = new Monque(client.db('myapp'), {
  collectionName: 'jobs',
  pollInterval: 1000,
  maxRetries: 10,
  defaultConcurrency: 5,
});

await monque.initialize();

// Register workers
monque.register('send-email', async (job) => {
  await sendEmail(job.data.to, job.data.subject);
});

// Start processing
monque.start();

// Enqueue jobs
await monque.enqueue('send-email', { to: 'user@example.com', subject: 'Hello' });

// Schedule recurring jobs
await monque.schedule('0 9 * * *', 'daily-report', { type: 'summary' });

// Management
await monque.cancelJob('job-id');
const stats = await monque.getQueueStats();

// Graceful shutdown
await monque.stop();
```

## API

### `new Monque(db, options?)`

Creates a new Monque instance.

**Options:**
- `collectionName` - MongoDB collection name (default: `'monque_jobs'`)
- `pollInterval` - Polling interval in ms (default: `1000`)
- `maxRetries` - Max retry attempts (default: `10`)
- `baseRetryInterval` - Base backoff interval in ms (default: `1000`)
- `shutdownTimeout` - Graceful shutdown timeout in ms (default: `30000`)
- `defaultConcurrency` - Jobs per worker (default: `5`)
- `lockTimeout` - Stale job threshold in ms (default: `1800000`)
- `recoverStaleJobs` - Recover stale jobs on startup (default: `true`)

### Methods

- `initialize()` - Set up collection and indexes
- `enqueue(name, data, options?)` - Enqueue a job
- `now(name, data)` - Enqueue for immediate processing
- `schedule(cron, name, data)` - Schedule recurring job
- `register(name, handler, options?)` - Register a worker
- `start()` - Start processing jobs
- `stop()` - Graceful shutdown
- `isHealthy()` - Check scheduler health

**Management:**
- `getJob(id)` - Get job details
- `getJobs(filter)` - List jobs
- `getJobsWithCursor(options)` - Paginated list
- `getQueueStats(filter?)` - Queue statistics
- `cancelJob(id)` - Cancel a job
- `retryJob(id)` - Retry a job
- `rescheduleJob(id, date)` - Reschedule a job
- `deleteJob(id)` - Delete a job
- `cancelJobs(filter)` - Bulk cancel
- `retryJobs(filter)` - Bulk retry
- `deleteJobs(filter)` - Bulk delete

### Events

```typescript
monque.on('job:start', (job) => { /* job started */ });
monque.on('job:complete', ({ job, duration }) => { /* job completed */ });
monque.on('job:fail', ({ job, error, willRetry }) => { /* job failed */ });
monque.on('job:error', ({ error, job? }) => { /* unexpected error */ });
monque.on('job:cancelled', ({ job }) => { /* job cancelled */ });
monque.on('job:retried', ({ job, previousStatus }) => { /* job retried */ });
monque.on('job:deleted', ({ jobId }) => { /* job deleted */ });
monque.on('stale:recovered', ({ count }) => { /* stale jobs recovered */ });
```

## Development

### Running Tests

```bash
# Run tests once (fresh container each time)
bun run test

# Run tests in watch mode with container reuse (faster iteration)
bun run test:dev

# Or enable reuse globally in your shell profile
export TESTCONTAINERS_REUSE_ENABLE=true
bun run test:watch
```

When `TESTCONTAINERS_REUSE_ENABLE=true`, the MongoDB testcontainer persists between test runs, significantly speeding up local development. Ryuk (the testcontainers cleanup daemon) remains enabled as a safety net for orphaned containers.

To manually clean up reusable containers:
```bash
docker ps -q --filter label=org.testcontainers=true | while read -r id; do docker stop "$id"; done
```

## License

ISC
