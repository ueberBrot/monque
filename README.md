# Monque

[![CI](https://github.com/ueberBrot/monque/actions/workflows/ci.yml/badge.svg)](https://github.com/ueberBrot/monque/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@monque/core.svg)](https://www.npmjs.com/package/@monque/core)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A MongoDB-backed job scheduler for Node.js with atomic locking, exponential backoff, cron scheduling, and event-driven observability.

📚 **[Documentation](https://monque.dev)** | 🚀 **[Quick Start](https://monque.dev/getting-started/quick-start/)**

## Packages

| Package                         | Description                                 |
| ------------------------------- | ------------------------------------------- |
| [@monque/core](./packages/core) | Core job scheduler with MongoDB backend     |
| [@monque/docs](./packages/docs) | Documentation site (Starlight)              |

## Features

- 🔒 **Atomic Locking** - Prevents duplicate job processing across multiple workers using MongoDB's atomic operations
- 🔄 **Exponential Backoff** - Automatic retries with configurable backoff: `nextRunAt = now + (2^failCount × baseInterval)`
- ⏰ **Cron Scheduling** - Schedule recurring jobs with standard 5-field cron expressions
- 📡 **Event-Driven** - Subscribe to `job:start`, `job:complete`, `job:fail`, `job:error` events
- 🛡️ **Type-Safe** - Full TypeScript support with generics for job payloads
- ⚡ **Change Streams** - Real-time job notifications via MongoDB Change Streams (no polling delay)
- 💓 **Heartbeat Monitoring** - Automatic stale job detection and recovery
- 🚀 **Framework Agnostic** - Works with any Node.js framework

## Quick Start

```bash
bun add @monque/core mongodb
```

```typescript
import { Monque } from '@monque/core';
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();

const monque = new Monque(client.db('myapp'));
await monque.initialize();

// Register a type-safe worker
interface EmailJob {
  to: string;
  subject: string;
}

monque.worker<EmailJob>('send-email', async (job) => {
  console.log('Sending email to:', job.data.to);
  await sendEmail(job.data);
});

// Monitor job lifecycle
monque.on('job:complete', ({ job, duration }) => {
  console.log(`Job ${job.name} completed in ${duration}ms`);
});

// Start processing
monque.start();

// Enqueue jobs
await monque.enqueue('send-email', { 
  to: 'user@example.com',
  subject: 'Welcome!'
});

// Schedule recurring jobs
await monque.schedule('0 9 * * *', 'daily-report', { type: 'sales' });

// Graceful shutdown
process.on('SIGTERM', async () => {
  await monque.stop();
  await client.close();
});
```

## Configuration

```typescript
const monque = new Monque(db, {
  collectionName: 'monque_jobs',   // Default: 'monque_jobs'
  pollInterval: 1000,              // Default: 1000ms (backup polling)
  maxRetries: 10,                  // Default: 10
  baseRetryInterval: 1000,         // Default: 1000ms
  shutdownTimeout: 30000,          // Default: 30s
  defaultConcurrency: 5,           // Default: 5 jobs per worker
  lockTimeout: 1800000,            // Default: 30 minutes
  heartbeatInterval: 30000,        // Default: 30s
  recoverStaleJobs: true,          // Default: true
});
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun run test

# Run tests with UI
bun test:dev

# Run tests with coverage
bun test:coverage

# Build all packages
bun run build

# Format code
bun run format

# Run docs locally
cd packages/docs && bun run dev
```

## Requirements

- Node.js 22+
- MongoDB 4.0+ (Replica Set required for Change Streams)

## Documentation

Visit [monque.dev](https://monque.dev) for comprehensive documentation:

- [Installation Guide](https://monque.dev/getting-started/installation/)
- [Quick Start Tutorial](https://monque.dev/getting-started/quick-start/)
- [Core Concepts](https://monque.dev/core-concepts/jobs/)
- [API Reference](https://monque.dev/api/)

## License

ISC © Maurice de Bruyn
