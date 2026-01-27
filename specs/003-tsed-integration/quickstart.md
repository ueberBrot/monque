# Quickstart: @monque/tsed

**Feature**: 003-tsed-integration
**Date**: 2026-01-22

## Installation

```bash
npm install @monque/tsed @monque/core mongodb
```

**Peer dependencies**: `@tsed/core`, `@tsed/di`, `@tsed/schema` (^8.0.0)

---

## Basic Setup

### 1. Configure the Server

```typescript
// src/Server.ts
import { Configuration } from "@tsed/di";
import { PlatformExpress } from "@tsed/platform-express";
import { MongoClient } from "mongodb";
import { MonqueModule } from "@monque/tsed";

@Configuration({
  imports: [MonqueModule],
  monque: {
    enabled: true,
    dbFactory: async () => {
      const client = await MongoClient.connect(process.env.MONGO_URI!);
      return client.db("myapp");
    },
    collectionName: "jobs",
  },
})
export class Server {}

// Bootstrap
async function bootstrap() {
  const platform = await PlatformExpress.bootstrap(Server);
  await platform.listen();
  console.log("Server started");
}

bootstrap();
```

### 2. Create a Worker Controller

```typescript
// src/workers/EmailWorkers.ts
import { WorkerController, Worker, Cron } from "@monque/tsed";
import { Inject } from "@tsed/di";
import type { Job } from "@monque/core";
import { EmailService } from "../services/EmailService";

interface WelcomeEmailPayload {
  userId: string;
  email: string;
}

interface NotificationPayload {
  userId: string;
  message: string;
}

@WorkerController("email")
export class EmailWorkers {
  @Inject()
  private emailService: EmailService;

  @Worker("send-welcome")
  async sendWelcome(job: Job<WelcomeEmailPayload>) {
    const { email } = job.data;
    await this.emailService.sendWelcome(email);
    console.log(`Welcome email sent to ${email}`);
  }

  @Worker("send-notification", { concurrency: 10 })
  async sendNotification(job: Job<NotificationPayload>) {
    await this.emailService.sendNotification(job.data.userId, job.data.message);
  }

  @Cron("0 9 * * *", { name: "daily-digest" })
  async sendDailyDigest(job: Job) {
    // Runs at 9am daily, registered as "email.daily-digest"
    await this.emailService.sendDailyDigest();
  }
}
```

### 3. Enqueue Jobs from Services

```typescript
// src/services/UserService.ts
import { Service, Inject } from "@tsed/di";
import { MonqueService } from "@monque/tsed";

interface CreateUserDto {
  email: string;
  name: string;
}

@Service()
export class UserService {
  @Inject()
  private monque: MonqueService;

  async createUser(data: CreateUserDto) {
    // Save user to database
    const user = { id: "user-123", ...data };

    // Queue welcome email (uses full namespaced name)
    await this.monque.enqueue("email.send-welcome", {
      userId: user.id,
      email: user.email,
    });

    // Schedule follow-up in 2 hours
    const twoHoursLater = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await this.monque.enqueue(
      "email.send-notification",
      {
        userId: user.id,
        message: "How is everything going?",
      },
      { runAt: twoHoursLater }
    );

    return user;
  }
}
```

---

## Configuration Options

### Option 1: Direct Database Instance

```typescript
import { MongoClient } from "mongodb";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();

@Configuration({
  monque: {
    enabled: true,
    db: client.db("myapp"),
  },
})
export class Server {}
```

### Option 2: Async Factory

```typescript
@Configuration({
  monque: {
    enabled: true,
    dbFactory: async () => {
      const client = await MongoClient.connect(process.env.MONGO_URI!);
      return client.db("myapp");
    },
  },
})
export class Server {}
```

### Option 3: DI Token

```typescript
import { registerProvider } from "@tsed/di";
import { MongoClient } from "mongodb";

// Register MongoDB provider
registerProvider({
  provide: "MONGODB_DATABASE",
  useFactory: async () => {
    const client = await MongoClient.connect(process.env.MONGO_URI!);
    return client.db("myapp");
  },
});

@Configuration({
  monque: {
    enabled: true,
    dbToken: "MONGODB_DATABASE",
  },
})
export class Server {}
```

---

## Advanced Usage

### Workers Without Namespace

```typescript
@WorkerController() // No namespace
export class SystemWorkers {
  @Worker("cleanup")
  async cleanup(job: Job) {
    // Registered as just "cleanup" (no prefix)
  }
}
```

### Prevent Duplicate Jobs

```typescript
await this.monque.enqueue(
  "sync.user",
  { userId: "123" },
  { uniqueKey: "sync-user-123" }
);
// Subsequent calls with same uniqueKey return existing job
```

### Job Management APIs

```typescript
import { Service, Inject } from "@tsed/di";
import { MonqueService } from "@monque/tsed";

@Service()
export class JobAdminService {
  @Inject()
  private monque: MonqueService;

  // Retry a failed job
  async retryFailedJob(jobId: string) {
    return this.monque.retryJob(jobId);
  }

  // Reschedule a pending job
  async delayJob(jobId: string, delayMinutes: number) {
    const runAt = new Date(Date.now() + delayMinutes * 60 * 1000);
    return this.monque.rescheduleJob(jobId, runAt);
  }

  // Cancel a pending job
  async cancelJob(jobId: string) {
    return this.monque.cancelJob(jobId);
  }

  // Delete a job permanently
  async deleteJob(jobId: string) {
    return this.monque.deleteJob(jobId);
  }

  // Bulk retry all failed jobs for a specific queue
  async retryAllFailed(queueName: string) {
    return this.monque.retryJobs({
      name: queueName,
      status: "failed",
    });
  }

  // Get queue statistics
  async getStats(queueName?: string) {
    return this.monque.getQueueStats(queueName ? { name: queueName } : undefined);
  }
}
```

### Job Query APIs

```typescript
import { JobStatus } from "@monque/core";

// Get all pending jobs
const pending = await this.monque.getJobs({ status: JobStatus.PENDING });

// Get jobs with pagination
const page1 = await this.monque.getJobs({ limit: 50, skip: 0 });
const page2 = await this.monque.getJobs({ limit: 50, skip: 50 });

// Cursor-based pagination for large datasets
const page = await this.monque.getJobsWithCursor({
  limit: 20,
  filter: { status: "pending" },
});

if (page.hasNextPage) {
  const nextPage = await this.monque.getJobsWithCursor({
    cursor: page.cursor,
    limit: 20,
  });
}

// Get queue statistics
const stats = await this.monque.getQueueStats();
console.log(`Pending: ${stats.pending}, Failed: ${stats.failed}`);
```

### Access MonqueService in Controllers

```typescript
import { Controller, Inject } from "@tsed/di";
import { Post } from "@tsed/schema";
import { BodyParams } from "@tsed/platform-params";
import { MonqueService } from "@monque/tsed";

@Controller("/orders")
export class OrderController {
  @Inject()
  private monque: MonqueService;

  @Post("/")
  async createOrder(@BodyParams() data: CreateOrderDto) {
    const order = await this.saveOrder(data);
    await this.monque.now("order.process", { orderId: order.id });
    return order;
  }
}
```

### Health Check Endpoint

```typescript
import { Controller, Inject } from "@tsed/di";
import { Get } from "@tsed/schema";
import { MonqueService } from "@monque/tsed";

@Controller("/health")
export class HealthController {
  @Inject()
  private monque: MonqueService;

  @Get("/")
  check() {
    return {
      status: "ok",
      monque: this.monque.isHealthy() ? "running" : "stopped",
    };
  }
}
```

---

## Testing

### Unit Tests with Mocked Monque

```typescript
import { PlatformTest } from "@tsed/platform-http/testing";
import { MonqueService } from "@monque/tsed";

describe("UserService", () => {
  beforeEach(() =>
    PlatformTest.create({
      monque: {
        enabled: false, // Disable for unit tests
      },
    })
  );
  afterEach(PlatformTest.reset);

  it("should enqueue welcome email", async () => {
    // Mock MonqueService
    const mockMonque = {
      enqueue: vi.fn().mockResolvedValue({ _id: "job-id" }),
    };

    const service = PlatformTest.get(UserService, [
      { token: MonqueService, use: mockMonque },
    ]);

    await service.createUser({ email: "test@example.com", name: "Test" });

    expect(mockMonque.enqueue).toHaveBeenCalledWith(
      "email.send-welcome",
      expect.objectContaining({ email: "test@example.com" })
    );
  });
});
```

### Integration Tests with Testcontainers

```typescript
import { PlatformTest } from "@tsed/platform-http/testing";
import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient } from "mongodb";

describe("EmailWorkers Integration", () => {
  let container: MongoDBContainer;
  let client: MongoClient;

  beforeAll(async () => {
    container = await new MongoDBContainer("mongo:8").start();
    client = new MongoClient(container.getConnectionString());
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
    await container.stop();
  });

  beforeEach(() =>
    PlatformTest.create({
      monque: {
        enabled: true,
        db: client.db("test"),
      },
    })
  );
  afterEach(PlatformTest.reset);

  it("should process welcome email job", async () => {
    const monque = PlatformTest.get(MonqueService);

    const job = await monque.enqueue("email.send-welcome", {
      userId: "user-1",
      email: "test@example.com",
    });

    expect(job._id).toBeDefined();
    expect(job.name).toBe("email.send-welcome");
  });
});
```

---

## Decorator Reference

| Decorator | Target | Description |
|-----------|--------|-------------|
| `@WorkerController(namespace?)` | Class | Marks class as job handler container |
| `@Worker(name, options?)` | Method | Registers method as job handler |
| `@Cron(pattern, options?)` | Method | Registers method as scheduled cron job |

---

## Next Steps

1. Check out the [full API reference](../PLAN.md#api-reference)
2. Learn about [implementation phases](../PLAN.md#implementation-phases)
3. See [@monque/core documentation](../../packages/core/README.md)
