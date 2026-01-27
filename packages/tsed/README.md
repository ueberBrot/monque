# @monque/tsed

A **Ts.ED** integration for **Monque**, a robust, type-safe MongoDB job queue for TypeScript.

This package provides native decorators and DI integration to easily create background workers and cron jobs within your Ts.ED application.

[![npm version](https://img.shields.io/npm/v/@monque/tsed.svg)](https://www.npmjs.com/package/@monque/tsed)
[![License](https://img.shields.io/npm/l/@monque/tsed.svg)](https://github.com/ueberBrot/monque/blob/main/LICENSE)

## Features

- 🎯 **Decorator-based API**: `@WorkerController`, `@Worker`, and `@Cron`
- 💉 **Dependency Injection**: Full support for Ts.ED DI (Controllers, Services)
- 🔒 **Job Isolation**: Each job runs in a dedicated `DIContext` (Request Scope support)
- 🔍 **Type Safety**: Fully typed jobs and payloads
- ⚡ **Zero Overhead**: Lightweight wrapper around `@monque/core`

## Installation

```bash
bun add @monque/tsed @monque/core mongodb
# or
npm install @monque/tsed @monque/core mongodb
```

## Configuration

Import `MonqueModule` in your `Server.ts` and configure the connection:

```typescript
import { Configuration } from "@tsed/di";
import { MonqueModule } from "@monque/tsed";
import { MongoClient } from "mongodb";
import "@tsed/platform-express"; // or @tsed/platform-koa

@Configuration({
  imports: [
    MonqueModule
  ],
  monque: {
    enabled: true,
    // Option 1: Provide existing Db instance via factory (Recommended)
    dbFactory: async () => {
        const client = new MongoClient(process.env.MONGO_URL);
        await client.connect();
        return client.db("my-app");
    },
    // Option 2: Use existing DI token
    // dbToken: MongoConnection
  }
})
export class Server {}
```

## Usage

### 1. Define a Worker Controller

Create a class decorated with `@WorkerController`. Methods decorated with `@Worker` will process jobs.

```typescript
import { WorkerController, Worker } from "@monque/tsed";
import { Job } from "@monque/core";
import { EmailService } from "./services/EmailService";

interface EmailPayload {
  to: string;
  subject: string;
}

@WorkerController("email") // Namespace prefix: "email."
export class EmailWorkers {
  constructor(private emailService: EmailService) {}

  @Worker("send", { concurrency: 5 }) // Job name: "email.send"
  async sendEmail(job: Job<EmailPayload>) {
    await this.emailService.send(
        job.data.to, 
        job.data.subject
    );
  }
}
```

### 2. Schedule Jobs (Cron)

Use the `@Cron` decorator to schedule recurring tasks.

```typescript
import { WorkerController, Cron } from "@monque/tsed";

@WorkerController()
export class ReportWorkers {
  
  @Cron("0 0 * * *", { name: "daily-report" })
  async generateDailyReport() {
    console.log("Generating report...");
  }
}
```

### 3. Enqueue Jobs

Inject `MonqueService` to dispatch jobs from anywhere in your app.

```typescript
import { Service, Inject } from "@tsed/di";
import { MonqueService } from "@monque/tsed";

@Service()
export class AuthService {
  @Inject()
  private monque: MonqueService;

  async registerUser(user: User) {
    // ... save user ...

    // Dispatch background job
    await this.monque.enqueue("email.send", {
      to: user.email,
      subject: "Welcome!"
    });
  }
}
```

## API Reference

### Decorators

#### `@WorkerController(namespace?: string)`
Class decorator to register a worker controller.
- `namespace`: Optional prefix for all worker names in this class.

#### `@Worker(name: string, options?: WorkerOptions)`
Method decorator to register a job handler.
- `name`: Job name (combined with namespace).
- `options`: Concurrency, priority, etc.

#### `@Cron(pattern: string, options?: ScheduleOptions)`
Method decorator to register a scheduled job.
- `pattern`: Cron expression (e.g., `* * * * *`).
- `options`: Timezone, job name override.

### Services

#### `MonqueService`
Injectable wrapper for the main `Monque` instance.
- `enqueue(name, data, opts)`
- `schedule(cron, name, data, opts)`
- `now(name, data)`
- `cancelJob(id)`
- `getJob(id)`

## Testing

Use `@tsed/platform-http/testing` and `PlatformTest` to test your workers. You can mock `MonqueService` or use a real Mongo connection with Testcontainers.

```typescript
import { PlatformTest } from "@tsed/platform-http/testing";
import { MonqueService } from "@monque/tsed";

describe("EmailWorkers", () => {
  beforeEach(PlatformTest.create);
  afterEach(PlatformTest.reset);

  it("should process email", async () => {
     const service = PlatformTest.get(MonqueService);
     // ... test logic ...
  });
});
```

## License

MIT
