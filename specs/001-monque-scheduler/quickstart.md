# Quickstart: Monque Job Scheduler

Get up and running with Monque in under 5 minutes.

## Installation

### Core Package

```bash
# Using npm
npm install @monque/core mongodb

# Using bun
bun add @monque/core mongodb

# Using pnpm
pnpm add @monque/core mongodb
```

### Ts.ED Integration (Optional)

```bash
npm install @monque/tsed @monque/core
```

## Basic Usage

### 1. Initialize Monque

```typescript
import { MongoClient } from 'mongodb';
import { Monque } from '@monque/core';

// Connect to MongoDB
const client = new MongoClient('mongodb://localhost:27017');
await client.connect();
const db = client.db('myapp');

// Create Monque instance
const monque = new Monque(db);
```

### 2. Register a Worker

```typescript
// Define your job data type
interface EmailJobData {
  to: string;
  subject: string;
  body: string;
}

// Register a worker for 'send-email' jobs
monque.worker<EmailJobData>('send-email', async (job) => {
  console.log(`Sending email to ${job.data.to}`);
  // Your email sending logic here
  await sendEmail(job.data.to, job.data.subject, job.data.body);
});
```

### 3. Enqueue Jobs

```typescript
// Enqueue a simple job (immediate execution)
await monque.now('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.',
});

// Or use enqueue() for more options
await monque.enqueue('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.',
});

// Enqueue with unique key (prevents duplicates)
await monque.enqueue('sync-user', { userId: '123' }, {
  uniqueKey: 'sync-user-123',
});

// Enqueue with delayed execution
await monque.enqueue('reminder', { message: 'Check in!' }, {
  runAt: new Date(Date.now() + 3600000), // 1 hour from now
});
```

### 4. Start Processing

```typescript
// Start the scheduler
monque.start();

// Listen to job events
monque.on('job:complete', ({ job, duration }) => {
  console.log(`Job ${job.name} completed in ${duration}ms`);
});

monque.on('job:fail', ({ job, error, willRetry }) => {
  console.error(`Job ${job.name} failed: ${error.message}`);
  if (willRetry) {
    console.log(`Will retry (attempt ${job.failCount + 1})`);
  }
});
```

### 5. Graceful Shutdown

```typescript
// Handle process termination
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await monque.stop(); // Waits for in-progress jobs
  await client.close();
  process.exit(0);
});
```

## Recurring Jobs (Cron)

```typescript
// Schedule a job to run every hour
await monque.schedule('0 * * * *', 'hourly-cleanup', {
  type: 'temp-files',
});

// Schedule daily report at midnight
await monque.schedule('0 0 * * *', 'daily-report', {
  reportType: 'sales',
});
```

## Ts.ED Integration

### 1. Configure the Module

```typescript
import { Configuration } from '@tsed/common';
import { MonqueModule } from '@monque/tsed';
import mongoose from 'mongoose';

@Configuration({
  imports: [
    MonqueModule.forRoot({
      connection: mongoose.connection, // Works with Mongoose or native Db
    }),
  ],
})
export class Server {}
```

### 2. Create Job Handlers

```typescript
import { Injectable } from '@tsed/di';
import { Job } from '@monque/tsed';
import type { IJob } from '@monque/core';

interface OrderJobData {
  orderId: string;
}

@Job({ name: 'process-order' })
@Injectable()
export class ProcessOrderJob {
  constructor(
    private orderService: OrderService, // Full DI access
    private emailService: EmailService,
  ) {}

  async handle(job: IJob<OrderJobData>): Promise<void> {
    const order = await this.orderService.findById(job.data.orderId);
    await this.orderService.process(order);
    await this.emailService.sendOrderConfirmation(order);
  }
}
```

### 3. Enqueue from Services

```typescript
import { Injectable } from '@tsed/di';
import { Monque } from '@monque/core';

@Injectable()
export class OrderController {
  constructor(private monque: Monque) {}

  async createOrder(data: CreateOrderDto) {
    const order = await this.saveOrder(data);
    
    // Queue background processing
    await this.monque.enqueue('process-order', {
      orderId: order.id,
    });
    
    return order;
  }
}
```

## Configuration Options

```typescript
const monque = new Monque(db, {
  // Collection name for storing jobs
  collectionName: 'monque_jobs', // default
  
  // Polling interval in milliseconds
  pollInterval: 1000, // default
  
  // Max retry attempts before permanent failure
  maxRetries: 10, // default
  
  // Base interval for exponential backoff (ms)
  baseRetryInterval: 1000, // default
  
  // Graceful shutdown timeout (ms)
  shutdownTimeout: 30000, // default
  
  // Default concurrent jobs per worker
  defaultConcurrency: 5, // default

  // Heartbeat interval for processing jobs (ms)
  heartbeatInterval: 30000, // default

  // Tolerance for zombie job detection (ms)
  heartbeatTolerance: 90000, // default

  // Enable zombie job takeover
  enableZombieTakeover: true, // default
});
```

## Event Reference

| Event          | Payload                     | Description               |
| -------------- | --------------------------- | ------------------------- |
| `job:start`    | `IJob`                      | Job begins processing     |
| `job:complete` | `{ job, duration }`         | Job finished successfully |
| `job:fail`     | `{ job, error, willRetry }` | Job failed                |
| `job:error`    | `{ error, job? }`           | Unexpected error occurred |

## Next Steps

- [Full API Reference](./contracts/job-schema.ts)
- [Data Model](./data-model.md)
- [Research & Design Decisions](./research.md)
