<p align="center">
  <img src="assets/logo-with-text.svg" alt="Monque Logo" width="800"/>
</p>

<p align="center">
  <a href="https://github.com/ueberbrot/monque/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/ueberbrot/monque/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI" />
  </a>
  <a href="https://www.npmjs.com/package/@monque/core">
    <img src="https://img.shields.io/npm/v/%40monque%2Fcore?style=for-the-badge&label=%40monque%2Fcore" alt="@monque/core version" />
  </a>
  <a href="https://github.com/ueberbrot/monque/actions/workflows/deploy-docs.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/ueberbrot/monque/deploy-docs.yml?branch=main&style=for-the-badge&label=DOCS" alt="Docs" />
  </a>
  <a href="https://codecov.io/gh/ueberBrot/monque">
    <img src="https://img.shields.io/codecov/c/github/ueberBrot/monque?style=for-the-badge&logo=codecov&logoColor=white" alt="Codecov" />
  </a>
  <a href="https://github.com/ueberbrot/monque/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/ueberbrot/monque?style=for-the-badge&label=LICENSE" alt="License" />
  </a>
  <a href="https://ueberBrot.github.io/monque/">
    <img src="https://img.shields.io/website?url=https%3A%2F%2FueberBrot.github.io%2Fmonque%2F&style=for-the-badge&label=WEBSITE" alt="Website" />
  </a>
</p>

<p align="center">
  <b>A MongoDB-backed job scheduler with atomic locking, exponential backoff, cron scheduling, and event-driven observability.</b>
</p>

<p align="center">
  📚 <a href="https://ueberBrot.github.io/monque/"><b>Documentation</b></a> | 🚀 <a href="https://ueberBrot.github.io/monque/getting-started/quick-start/"><b>Quick Start</b></a>
</p>

> [!CAUTION]
> Monque is currently in **pre-release**. The public API may change between releases. Expect breaking changes until `1.0.0`.

## Packages

| Package                         | Description                                 |
| ------------------------------- | ------------------------------------------- |
| [@monque/core](./packages/core) | Core job scheduler with MongoDB backend     |
| [@monque/docs](./apps/docs)     | Documentation site                          |

## Features

- 🔒 **Atomic Locking** - Prevents duplicate job processing across multiple schedulers using MongoDB atomic operations
- 💓 **Heartbeat Monitoring** - Automatic stale job detection and recovery
- 🛡️ **Type-Safe** - Full TypeScript support with generics for job payloads
- 🔌 **Framework Agnostic** - Works with any Node.js framework
- 🔔 **Event-Driven** - Subscribe to job lifecycle events for observability and integrations
- 📡 **Change Streams** - Real-time job notifications via MongoDB Change Streams (polling remains as a safety net)
- ⏰ **Cron Scheduling** - Schedule recurring jobs with standard 5-field cron expressions
- 🔄 **Exponential Backoff** - Automatic retries with configurable exponential backoff

## Quick Start

Install dependencies (MongoDB is a peer dependency):
```bash
bun add @monque/core mongodb

npm install @monque/core mongodb

pnpm add @monque/core mongodb
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

monque.register<EmailJob>('send-email', async (job) => {
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

This repository uses Bun workspaces and scripts for development.

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
- Bun 1.3.5+ (development only; required to work on this repo)

## Documentation

Visit the documentation site for comprehensive guides:

- [Installation Guide](https://ueberBrot.github.io/monque/getting-started/installation/)
- [Quick Start Tutorial](https://ueberBrot.github.io/monque/getting-started/quick-start/)
- [Core Concepts](https://ueberBrot.github.io/monque/core-concepts/jobs/)

## Inspired by

Monque draws inspiration from several excellent job scheduling libraries:

- [Agenda](https://github.com/agenda/agenda) - The original MongoDB job scheduler
- [Pulse](https://github.com/pulsecron/pulse) - A maintained fork of Agenda
- [BullMQ](https://github.com/taskforcesh/bullmq) - Robust Redis-based queue system
- [pg-boss](https://github.com/timgit/pg-boss) - Postgres-backed job queue
- [graphile-worker](https://github.com/graphile/worker) - High-performance Postgres worker

## License

ISC © Maurice de Bruyn
