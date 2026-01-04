# Monque

[![CI](https://github.com/ueberBrot/monque/actions/workflows/ci.yml/badge.svg)](https://github.com/ueberBrot/monque/actions/workflows/ci.yml)

A MongoDB-backed job scheduler for Node.js with atomic locking, exponential backoff, cron scheduling, and Ts.ED integration.

## Packages

| Package                         | Description                                 |
| ------------------------------- | ------------------------------------------- |
| [@monque/core](./packages/core) | Core job scheduler with MongoDB backend     |


## Features

- 🔒 **Atomic Locking** - Prevents duplicate job processing across multiple workers
- 🔄 **Exponential Backoff** - Automatic retries with configurable backoff strategy
- ⏰ **Cron Scheduling** - Schedule recurring jobs with standard cron expressions
- 📡 **Event-Driven** - Subscribe to job lifecycle events for observability
- 🛡️ **Type-Safe** - Full TypeScript support with generics
- 🚀 **Framework Agnostic** - Use standalone or with Ts.ED integration

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

// Register a worker
monque.worker('send-email', async (job) => {
  console.log('Sending email to:', job.data.to);
});

// Start processing
monque.start();

// Enqueue a job
await monque.enqueue('send-email', { to: 'user@example.com' });
```

## Development

```bash
# Install dependencies
bun install

# Run tests
bun run test

# Run tests with UI
bun test:ui

# Run tests with coverage
bun test:coverage

# Build all packages
bun run build

# Format code
bun run format
```

## Requirements

- Node.js 22+
- MongoDB 4.0+

## License

ISC © Maurice de Bruyn
