<p align="center">
  <img src="../../assets/logo.svg" width="180" alt="Monque logo" />
</p>

<h1 align="center">@monque/tsed</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@monque/tsed">
    <img src="https://img.shields.io/npm/v/%40monque%2Ftsed?style=for-the-badge&label=%40monque%2Ftsed" alt="@monque/tsed version" />
  </a>
  <a href="https://github.com/ueberBrot/monque/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/ueberBrot/monque/ci.yml?branch=main&style=for-the-badge&logo=github" alt="CI Status" />
  </a>
  <a href="https://codecov.io/gh/ueberBrot/monque">
    <img src="https://img.shields.io/codecov/c/github/ueberBrot/monque?style=for-the-badge&logo=codecov&logoColor=white" alt="Codecov" />
  </a>
  <a href="https://opensource.org/licenses/ISC">
    <img src="https://img.shields.io/badge/License-ISC-blue.svg?style=for-the-badge" alt="License: ISC" />
  </a>
  <a href="https://bun.sh">
    <img src="https://img.shields.io/badge/Built%20with-Bun-fbf0df?style=for-the-badge&logo=bun&logoColor=black" alt="Built with Bun" />
  </a>
</p>

A **Ts.ED** integration for **Monque**, a robust, type-safe MongoDB job queue for TypeScript.

## Features

- **Decorator-based API**: `@JobController`, `@Job`, and `@Cron` for declarative job handling.
- **Dependency Injection**: Full support for Ts.ED DI (inject Services/Providers into your jobs).
- **Job Isolation**: Each job execution runs in a dedicated `DIContext` with Request Scope support.
- **Type Safety**: Leverage TypeScript generics for fully typed job payloads.
- **Full Monque Power**: Complete access to all `@monque/core` features (backoff, heartbeats, atomic locking).
- **Seamless Integration**: Native lifecycle hooks support (`$onInit`, `$onDestroy`) for graceful scheduler management.

## Installation

```bash
bun add @monque/tsed @monque/core @tsed/mongoose mongoose
```

Or using npm/yarn/pnpm:
```bash
npm install @monque/tsed @monque/core @tsed/mongoose mongoose
yarn add @monque/tsed @monque/core @tsed/mongoose mongoose
pnpm add @monque/tsed @monque/core @tsed/mongoose mongoose
```

## Configuration

Import `MonqueModule` in your `Server.ts` and configure the connection:

```typescript
import { Configuration } from "@tsed/di";
import { MonqueModule } from "@monque/tsed";
import "@tsed/mongoose";
import "@tsed/platform-express"; // or @tsed/platform-koa

@Configuration({
  imports: [
    MonqueModule
  ],
  mongoose: [
    {
      id: "default",
      url: "mongodb://localhost:27017/my-app",
      connectionOptions: {}
    }
  ],
  monque: {
    enabled: true,
    // Option 1: Reuse existing Mongoose connection (Recommended)
    mongooseConnectionId: "default",

    // Option 2: Provide existing Db instance via factory
    // dbFactory: async () => {
    //     const client = new MongoClient(process.env.MONGO_URL);
    //     await client.connect();
    //     return client.db("my-app");
    // },
  }
})
export class Server {}
```

## Usage

### 1. Define a Job Controller

Create a class decorated with `@JobController`. Methods decorated with `@Job` will process jobs.

```typescript
import { JobController, Job } from "@monque/tsed";
import { Job as MonqueJob } from "@monque/core";
import { EmailService } from "./services/EmailService";

interface EmailPayload {
  to: string;
  subject: string;
}

@JobController("email") // Namespace prefix: "email."
export class EmailJobs {
  constructor(private emailService: EmailService) {}

  @Job("send", { concurrency: 5 }) // Job name: "email.send"
  async sendEmail(job: MonqueJob<EmailPayload>) {
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
import { JobController, Cron } from "@monque/tsed";

@JobController()
export class ReportJobs {
  
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

#### `@JobController(namespace?: string)`
Class decorator to register a job controller.
- `namespace`: Optional prefix for all job names in this class.

#### `@Job(name: string, options?: WorkerOptions)`
Method decorator to register a job handler.
- `name`: Job name (combined with namespace).
- `options`: Supports all `@monque/core` [WorkerOptions](../../packages/core/README.md#new-monque-db-options) (concurrency, lockTimeout, etc.).

#### `@Cron(pattern: string, options?: ScheduleOptions)`
Method decorator to register a scheduled job.
- `pattern`: Cron expression (e.g., `* * * * *`).
- `options`: Supports all `@monque/core` [ScheduleOptions](../../packages/core/README.md#methods) (tz, job name override, etc.).

### Services

#### `MonqueService`
Injectable wrapper for the main `Monque` instance. It exposes the full Monque public API through dependency injection.

**Job Scheduling:**
- `enqueue(name, data, opts)` - Enqueue a job
- `schedule(cron, name, data, opts)` - Schedule a recurring job
- `now(name, data)` - Enqueue for immediate processing

**Job Management:**
- `getJob(id)` / `getJobs(filter)` - Query jobs
- `cancelJob(id)` / `cancelJobs(filter)` - Cancel jobs
- `retryJob(id)` / `retryJobs(filter)` - Retry failed jobs
- `deleteJob(id)` / `deleteJobs(filter)` - Delete jobs
- `rescheduleJob(id, date)` - Change execution time

**Observability:**
- `getQueueStats(filter?)` - Get queue statistics
- `isHealthy()` - Check scheduler health
- `getJobsWithCursor(opts)` - Paginated job list

> [!TIP]
> All methods on `MonqueService` delegate to the underlying `Monque` instance. For a complete list of methods and options, see the [@monque/core documentation](../../packages/core/README.md).

## Testing

Use `@tsed/platform-http/testing` and `PlatformTest` to test your workers. You can mock `MonqueService` or use a real Mongo connection with Testcontainers.

```typescript
import { PlatformTest } from "@tsed/platform-http/testing";
import { MonqueService } from "@monque/tsed";

describe("EmailJobs", () => {
  beforeEach(PlatformTest.create);
  afterEach(PlatformTest.reset);

  it("should process email", async () => {
    const service = PlatformTest.get<MonqueService>(MonqueService);
    // ... test logic ...
  });
});
```

## License

ISC
