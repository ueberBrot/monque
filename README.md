# Monque

[![CI](https://img.shields.io/github/actions/workflow/status/ueberbrot/monque/ci.yml?branch=main&style=for-the-badge&label=CI)](https://github.com/ueberbrot/monque/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/github/actions/workflow/status/ueberbrot/monque/deploy-docs.yml?branch=main&style=for-the-badge&label=DOCS)](https://github.com/ueberbrot/monque/actions/workflows/deploy-docs.yml)
[![Coverage](https://img.shields.io/codecov/c/github/ueberbrot/monque?branch=main&style=for-the-badge&label=COVERAGE)](https://codecov.io/gh/ueberbrot/monque)
[![License](https://img.shields.io/github/license/ueberbrot/monque?style=for-the-badge&label=LICENSE)](https://github.com/ueberbrot/monque/blob/main/LICENSE)
[![Website](https://img.shields.io/website?url=https%3A%2F%2FueberBrot.github.io%2Fmonque%2F&style=for-the-badge&label=WEBSITE)](https://ueberBrot.github.io/monque/)

A MongoDB-backed job scheduler for Node.js with atomic locking, exponential backoff, cron scheduling, and event-driven observability.

📚 **[Documentation](https://ueberBrot.github.io/monque/)** | 🚀 **[Quick Start](https://ueberBrot.github.io/monque/getting-started/quick-start/)**

> [!WARNING]
> Monque is currently in **pre-release (0.x)**. The public API may change between releases. Expect breaking changes until `1.0.0`.

## Packages

| Package                         | Description                                 |
| ------------------------------- | ------------------------------------------- |
| [@monque/core](./packages/core) | Core job scheduler with MongoDB backend     |
| [@monque/docs](./apps/docs)     | Documentation site (Starlight)              |

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

Using Bun (see [Requirements](#requirements)):
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

# Build all packages & apps
bun run build

# Format & lint code
bun run check

# Run docs locally
bun run dev:docs
```

## Requirements

- Node.js 22+
- MongoDB 4.0+ (Replica Set required for Change Streams)
- Bun 1.3.5+

## Documentation

Visit the documentation site for comprehensive guides:

- [Installation Guide](https://ueberBrot.github.io/monque/getting-started/installation/)
- [Quick Start Tutorial](https://ueberBrot.github.io/monque/getting-started/quick-start/)
- [Core Concepts](https://ueberBrot.github.io/monque/core-concepts/jobs/)
- [API Reference](https://ueberBrot.github.io/monque/api/)

## License

ISC © Maurice de Bruyn
