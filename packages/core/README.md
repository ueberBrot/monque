# @monque/core

MongoDB-backed job scheduler with atomic locking, exponential backoff, and cron scheduling.

## Installation

```bash
bun add @monque/core mongodb
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
monque.worker('send-email', async (job) => {
  await sendEmail(job.data.to, job.data.subject);
});

// Start processing
monque.start();

// Enqueue jobs
await monque.enqueue('send-email', { to: 'user@example.com', subject: 'Hello' });

// Schedule recurring jobs
await monque.schedule('0 9 * * *', 'daily-report', { type: 'summary' });

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
- `worker(name, handler, options?)` - Register a worker
- `start()` - Start processing jobs
- `stop()` - Graceful shutdown
- `isHealthy()` - Check scheduler health

### Events

```typescript
monque.on('job:start', (job) => { /* job started */ });
monque.on('job:complete', ({ job, duration }) => { /* job completed */ });
monque.on('job:fail', ({ job, error, willRetry }) => { /* job failed */ });
monque.on('job:error', ({ error, job? }) => { /* unexpected error */ });
monque.on('stale:recovered', ({ count }) => { /* stale jobs recovered */ });
```

## License

ISC
