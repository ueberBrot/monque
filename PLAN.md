# @monque/tsed - Technical Plan

> Ts.ED integration for Monque - MongoDB-based job queue

## Overview

| Attribute | Value |
|-----------|-------|
| **Package Name** | `@monque/tsed` |
| **Location** | `packages/tsed/` |
| **Build Tool** | tsdown (ESM + CJS) |
| **Target** | Node 22+ |
| **Test Framework** | Vitest 4.x |
| **Test Strategy** | Unit tests with mocks + Integration tests with Testcontainers |

This package provides a Ts.ED integration for `@monque/core`, following the patterns established by `@tsed/bullmq` and `@tsed/agenda`.

---

## API Design

### Decorator Usage

```typescript
import { WorkerController, Worker, Cron } from "@monque/tsed";
import { Inject } from "@tsed/di";
import type { Job } from "@monque/core";

// With namespace - jobs prefixed with "email."
@WorkerController("email")
export class EmailWorkers {
  @Inject()
  private userService: UserService;

  @Worker("send-welcome")       // Registered as "email.send-welcome"
  async sendWelcome(job: Job<{ userId: string }>) {
    const user = await this.userService.getById(job.data.userId);
    await this.emailClient.send(user.email, "Welcome!");
  }

  @Worker("send-notification")  // Registered as "email.send-notification"
  async sendNotification(job: Job<{ userId: string; message: string }>) {
    // ...
  }

  @Cron("0 9 * * *", { name: "daily-digest" })  // Registered as "email.daily-digest"
  async dailyDigest(job: Job) {
    // Runs at 9am daily
  }
}

// Without namespace - jobs use raw names
@WorkerController()
export class SystemWorkers {
  @Worker("cleanup")            // Registered as "cleanup"
  async cleanup(job: Job) {
    // ...
  }
}
```

### Programmatic Usage

```typescript
import { MonqueService } from "@monque/tsed";
import { Service, Inject } from "@tsed/di";

@Service()
export class UserService {
  @Inject()
  private monque: MonqueService;

  async createUser(data: CreateUserDto) {
    const user = await this.save(data);
    
    // Enqueue a job programmatically (use full namespaced name)
    await this.monque.enqueue("email.send-welcome", { userId: user.id });
    
    // Schedule a follow-up
    await this.monque.schedule("in 2 hours", "email.send-followup", { userId: user.id });
    
    return user;
  }
}
```

### Configuration

```typescript
import { Configuration } from "@tsed/di";
import "@monque/tsed"; // Side-effect import to register module

// Option 1: Direct Db instance
@Configuration({
  monque: {
    enabled: true,
    db: mongoClient.db("myapp"),
    collectionName: "jobs",
    pollInterval: 1000
  }
})
export class Server {}

// Option 2: Factory function (async)
@Configuration({
  monque: {
    enabled: true,
    dbFactory: async () => {
      const client = await MongoClient.connect(process.env.MONGO_URI!);
      return client.db("myapp");
    }
  }
})
export class Server {}

// Option 3: Inject from DI provider token
@Configuration({
  monque: {
    enabled: true,
    dbToken: "MONGODB_DATABASE"  // Will inject from DI using this token
  }
})
export class Server {}
```

---

## Package Structure

```
packages/tsed/
├── src/
│   ├── index.ts                        # Barrel exports
│   ├── MonqueModule.ts                 # Main module (lifecycle hooks, worker registration)
│   │
│   ├── config/
│   │   └── config.ts                   # MonqueTsedConfig + TsED augmentation
│   │
│   ├── constants/
│   │   ├── MonqueTypes.ts              # Provider types (WORKER_CONTROLLER)
│   │   └── constants.ts                # MONQUE Symbol for Store
│   │
│   ├── contracts/
│   │   ├── index.ts
│   │   ├── WorkerMethods.ts            # Worker handler interface
│   │   └── WorkerStore.ts              # Metadata stored by decorators
│   │
│   ├── decorators/
│   │   ├── index.ts
│   │   ├── WorkerController.ts         # @WorkerController class decorator
│   │   ├── Worker.ts                   # @Worker method decorator
│   │   ├── Cron.ts                     # @Cron method decorator
│   │   └── InjectMonque.ts             # @InjectMonque property decorator
│   │
│   ├── services/
│   │   ├── index.ts
│   │   └── MonqueService.ts            # Injectable Monque wrapper
│   │
│   └── utils/
│       ├── getWorkerToken.ts           # Token generation
│       ├── resolveDatabase.ts          # Multi-strategy DB resolution
│       └── collectWorkerMetadata.ts    # Collect method decorator metadata
│
├── tests/
│   ├── setup/
│   │   ├── global-setup.ts             # Testcontainers lifecycle
│   │   ├── mongodb.ts                  # Testcontainers singleton
│   │   └── test-utils.ts               # Helper functions
│   │
│   ├── unit/                           # Fast tests, no MongoDB
│   │   ├── decorators/
│   │   │   ├── WorkerController.test.ts
│   │   │   ├── Worker.test.ts
│   │   │   └── Cron.test.ts
│   │   ├── services/
│   │   │   └── MonqueService.test.ts
│   │   └── utils/
│   │       └── resolveDatabase.test.ts
│   │
│   └── integration/                    # Full DI + MongoDB tests
│       ├── MonqueModule.test.ts
│       ├── worker-registration.test.ts
│       └── cron-jobs.test.ts
│
├── package.json
├── tsconfig.json
├── tsdown.config.ts
├── vitest.config.ts                    # Full tests (integration + unit)
├── vitest.unit.config.ts               # Unit tests only
└── README.md
```

---

## Dependencies

### package.json

```json
{
  "name": "@monque/tsed",
  "version": "0.1.0",
  "description": "Ts.ED integration for Monque - MongoDB-based job queue",
  "type": "module",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.mts",
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "test:unit": "vitest run --config vitest.unit.config.ts",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "tslib": "^2.7.0"
  },
  "peerDependencies": {
    "@monque/core": "^1.0.0",
    "@tsed/core": "^8.0.0",
    "@tsed/di": "^8.0.0",
    "@tsed/schema": "^8.0.0"
  },
  "devDependencies": {
    "@monque/core": "workspace:*",
    "@tsed/core": "^8.17.0",
    "@tsed/di": "^8.17.0",
    "@tsed/schema": "^8.17.0",
    "@tsed/platform-http": "^8.17.0",
    "@testcontainers/mongodb": "^10.18.0",
    "mongodb": "^6.15.0",
    "tsdown": "^0.11.17",
    "typescript": "^5.9.0",
    "vitest": "^4.1.0"
  },
  "files": ["dist"],
  "publishConfig": {
    "access": "public"
  }
}
```

---

## API Reference

### Decorators

| Decorator | Type | Signature | Description |
|-----------|------|-----------|-------------|
| `@WorkerController` | Class | `(namespace?: string, options?: WorkerControllerOptions)` | Marks a class as containing worker methods. Optional namespace prefixes all job names. |
| `@Worker` | Method | `(name: string, options?: WorkerOptions)` | Registers method as a job handler |
| `@Cron` | Method | `(pattern: string, options?: CronOptions)` | Registers method as a scheduled cron job handler |
| `@InjectMonque` | Property | `()` | Injects MonqueService instance |

### Services

| Service | Description |
|---------|-------------|
| `MonqueService` | Injectable wrapper for programmatic job operations (`enqueue`, `schedule`, `now`, etc.) |
| `MonqueModule` | Internal module handling lifecycle (`$onInit`, `$onDestroy`) and worker registration |

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | `boolean` | Enable/disable the module |
| `db` | `Db` | Direct MongoDB database instance |
| `dbFactory` | `() => Promise<Db> \| Db` | Factory function for lazy DB connection |
| `dbToken` | `string \| TokenProvider` | DI token to inject Db from |
| *(All MonqueOptions)* | | Forwarded to Monque constructor (`collectionName`, `pollInterval`, etc.) |

---

## Implementation Phases

### Phase 1: Foundation (Start Here)

**Goal:** Validate build, DI injection, and test setup work before adding complexity.

**Deliverables:**
- `src/index.ts` - Single export
- `src/services/MonqueService.ts` - Basic injectable service
- `tests/unit/services/MonqueService.test.ts` - Unit test with mock
- Build configuration files (`package.json`, `tsdown.config.ts`, `tsconfig.json`, `vitest.*.ts`)

**MonqueService (Phase 1):**
```typescript
import { injectable } from "@tsed/di";
import type {
  Monque,
  EnqueueOptions,
  ScheduleOptions,
  GetJobsFilter,
  CursorOptions,
  JobSelector,
  BulkOperationResult,
  CursorPage,
  PersistedJob,
  QueueStats,
} from "@monque/core";
import type { ObjectId } from "mongodb";

export class MonqueService {
  private _monque: Monque | null = null;

  get monque(): Monque {
    if (!this._monque) {
      throw new Error("MonqueService not initialized. Ensure MonqueModule is loaded.");
    }
    return this._monque;
  }

  /** @internal - Called by MonqueModule */
  setInstance(monque: Monque) {
    this._monque = monque;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Scheduling
  // ─────────────────────────────────────────────────────────────────────────────

  async enqueue<T>(name: string, data: T, options?: EnqueueOptions) {
    return this.monque.enqueue(name, data, options);
  }

  async now<T>(name: string, data: T) {
    return this.monque.now(name, data);
  }

  async schedule<T>(cron: string, name: string, data: T, options?: ScheduleOptions) {
    return this.monque.schedule(cron, name, data, options);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Management (Single Job)
  // ─────────────────────────────────────────────────────────────────────────────

  async cancelJob(jobId: string) {
    return this.monque.cancelJob(jobId);
  }

  async retryJob(jobId: string) {
    return this.monque.retryJob(jobId);
  }

  async rescheduleJob(jobId: string, runAt: Date) {
    return this.monque.rescheduleJob(jobId, runAt);
  }

  async deleteJob(jobId: string) {
    return this.monque.deleteJob(jobId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Management (Bulk Operations)
  // ─────────────────────────────────────────────────────────────────────────────

  async cancelJobs(filter: JobSelector): Promise<BulkOperationResult> {
    return this.monque.cancelJobs(filter);
  }

  async retryJobs(filter: JobSelector): Promise<BulkOperationResult> {
    return this.monque.retryJobs(filter);
  }

  async deleteJobs(filter: JobSelector): Promise<BulkOperationResult> {
    return this.monque.deleteJobs(filter);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Job Queries
  // ─────────────────────────────────────────────────────────────────────────────

  async getJob<T>(jobId: string | ObjectId): Promise<PersistedJob<T> | null> {
    return this.monque.getJob<T>(jobId as ObjectId);
  }

  async getJobs<T>(filter?: GetJobsFilter): Promise<PersistedJob<T>[]> {
    return this.monque.getJobs<T>(filter);
  }

  async getJobsWithCursor<T>(options?: CursorOptions): Promise<CursorPage<T>> {
    return this.monque.getJobsWithCursor<T>(options);
  }

  async getQueueStats(filter?: Pick<JobSelector, 'name'>): Promise<QueueStats> {
    return this.monque.getQueueStats(filter);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Health Check
  // ─────────────────────────────────────────────────────────────────────────────

  isHealthy() {
    return this.monque.isHealthy();
  }
}

injectable(MonqueService);
```

**Test (Phase 1):**
```typescript
import { PlatformTest } from "@tsed/platform-http/testing";
import { MonqueService } from "../../../src/services/MonqueService.js";

describe("MonqueService", () => {
  beforeAll(() => PlatformTest.create());
  afterAll(PlatformTest.reset);

  it("should be injectable", () => {
    const service = PlatformTest.get<MonqueService>(MonqueService);
    expect(service).toBeInstanceOf(MonqueService);
  });

  it("should throw if not initialized", () => {
    const service = PlatformTest.get<MonqueService>(MonqueService);
    expect(() => service.monque).toThrow("MonqueService not initialized");
  });
});
```

---

### Phase 2: Configuration & Module

**Goal:** Add configuration support and the main module with lifecycle hooks.

**Deliverables:**
- `src/config/config.ts` - Configuration type with TsED augmentation
- `src/MonqueModule.ts` - Module with `$onInit`, `$onDestroy` hooks
- `src/utils/resolveDatabase.ts` - Multi-strategy DB resolution
- `tests/unit/utils/resolveDatabase.test.ts`
- `tests/integration/MonqueModule.test.ts`

**Config type:**
```typescript
import type { MonqueOptions } from "@monque/core";
import type { Db } from "mongodb";
import type { TokenProvider } from "@tsed/di";

export interface MonqueTsedConfig extends Omit<MonqueOptions, never> {
  enabled?: boolean;
  db?: Db;
  dbFactory?: () => Promise<Db> | Db;
  dbToken?: TokenProvider<Db> | string;
}

declare global {
  namespace TsED {
    interface Configuration {
      monque?: MonqueTsedConfig;
    }
  }
}
```

**Database resolution utility:**
```typescript
import { inject, type TokenProvider } from "@tsed/di";
import type { Db } from "mongodb";
import type { MonqueTsedConfig } from "../config/config.js";

export async function resolveDatabase(config: MonqueTsedConfig): Promise<Db> {
  // Strategy 1: Direct Db instance
  if (config.db) {
    return config.db;
  }

  // Strategy 2: Factory function
  if (config.dbFactory) {
    return config.dbFactory();
  }

  // Strategy 3: Inject from DI token
  if (config.dbToken) {
    const db = inject<Db>(config.dbToken as TokenProvider);
    if (!db) {
      throw new Error(`Could not resolve database from token: ${String(config.dbToken)}`);
    }
    return db;
  }

  throw new Error("MonqueTsedConfig requires 'db', 'dbFactory', or 'dbToken' to be set");
}
```

---

### Phase 3: WorkerController + Worker Decorators

**Goal:** Add `@WorkerController` class decorator and `@Worker` method decorator.

**Deliverables:**
- `src/constants/MonqueTypes.ts` - Provider type constants
- `src/constants/constants.ts` - MONQUE store symbol
- `src/contracts/WorkerStore.ts` - Metadata shape
- `src/decorators/WorkerController.ts`
- `src/decorators/Worker.ts`
- `src/utils/collectWorkerMetadata.ts`
- Update `MonqueModule.ts` for worker registration
- `tests/unit/decorators/WorkerController.test.ts`
- `tests/unit/decorators/Worker.test.ts`
- `tests/integration/worker-registration.test.ts`

**WorkerController decorator:**
```typescript
import { StoreMerge, useDecorators } from "@tsed/core";
import { Injectable } from "@tsed/di";
import { MonqueTypes } from "../constants/MonqueTypes.js";
import { MONQUE } from "../constants/constants.js";

export interface WorkerControllerOptions {
  // Future extensibility
}

export function WorkerController(
  namespace?: string,
  options?: WorkerControllerOptions
) {
  return useDecorators(
    StoreMerge(MONQUE, {
      type: "controller",
      namespace,
      workers: [],
      cronJobs: []
    }),
    Injectable({
      type: MonqueTypes.WORKER_CONTROLLER
    })
  );
}
```

**Worker decorator:**
```typescript
import { StoreMerge, Store } from "@tsed/core";
import { MONQUE } from "../constants/constants.js";
import type { WorkerOptions } from "@monque/core";

export interface WorkerDecoratorOptions extends WorkerOptions {}

export function Worker(name: string, options: WorkerDecoratorOptions = {}) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const store = Store.from(target.constructor);
    const metadata = store.get(MONQUE) || { workers: [], cronJobs: [] };
    
    metadata.workers = [
      ...(metadata.workers || []),
      { name, method: propertyKey, opts: options }
    ];
    
    store.set(MONQUE, metadata);
    return descriptor;
  };
}
```

---

### Phase 4: Cron Decorator

**Goal:** Add `@Cron` method decorator for scheduled recurring jobs.

**Deliverables:**
- `src/decorators/Cron.ts`
- Update `MonqueModule.ts` for cron job scheduling
- `tests/unit/decorators/Cron.test.ts`
- `tests/integration/cron-jobs.test.ts`

**Cron decorator:**
```typescript
import { Store } from "@tsed/core";
import { MONQUE } from "../constants/constants.js";
import type { ScheduleOptions } from "@monque/core";

export interface CronDecoratorOptions extends ScheduleOptions {
  name?: string;  // Override job name (defaults to method name)
}

export function Cron(pattern: string, options: CronDecoratorOptions = {}) {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    const store = Store.from(target.constructor);
    const metadata = store.get(MONQUE) || { workers: [], cronJobs: [] };
    
    metadata.cronJobs = [
      ...(metadata.cronJobs || []),
      {
        pattern,
        name: options.name || propertyKey,
        method: propertyKey,
        opts: options
      }
    ];
    
    store.set(MONQUE, metadata);
    return descriptor;
  };
}
```

---

### Phase 5: InjectMonque Decorator

**Goal:** Add convenience decorator for injecting MonqueService.

**Deliverables:**
- `src/decorators/InjectMonque.ts`
- Tests

**InjectMonque decorator:**
```typescript
import { Inject } from "@tsed/di";
import { MonqueService } from "../services/MonqueService.js";

export function InjectMonque(): PropertyDecorator {
  return Inject(MonqueService);
}
```

---

### Phase 6: Full Integration Tests

**Goal:** End-to-end tests with real MongoDB via Testcontainers.

**Deliverables:**
- `tests/setup/global-setup.ts` - Testcontainers lifecycle
- `tests/setup/mongodb.ts` - Testcontainers singleton (reuse pattern from core)
- `tests/setup/test-utils.ts` - Helper functions
- Comprehensive integration tests

---

## Testing Patterns

### Unit Tests (Mock Monque)

```typescript
vi.mock("@monque/core", () => ({
  Monque: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    register: vi.fn(),
    enqueue: vi.fn().mockResolvedValue({ _id: "mock-id" }),
    schedule: vi.fn().mockResolvedValue({ _id: "mock-id" })
  }))
}));
```

### Integration Tests (PlatformTest)

```typescript
import { PlatformTest } from "@tsed/platform-http/testing";
import { MonqueModule } from "../../src/MonqueModule.js";
import { WorkerController, Worker } from "../../src/decorators/index.js";

@WorkerController("test")
class TestWorker {
  @Worker("example")
  handle(job: Job<{ msg: string }>) {
    console.log(job.data.msg);
  }
}

describe("MonqueModule", () => {
  afterEach(PlatformTest.reset);

  describe("with config", () => {
    beforeEach(() =>
      PlatformTest.create({
        monque: {
          enabled: true,
          db: mockDb
        }
      })
    );

    it("should register workers", () => {
      const module = PlatformTest.get<MonqueModule>(MonqueModule);
      expect(module.isEnabled()).toBe(true);
    });
  });
});
```

### Integration Tests (Testcontainers)

```typescript
import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient } from "mongodb";

const container = await new MongoDBContainer("mongo:8").start();
const client = new MongoClient(container.getConnectionString());
const db = client.db("test");
```

---

## Configuration Files

### tsdown.config.ts

```typescript
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
  outDir: "dist",
  external: ["@monque/core", "@tsed/core", "@tsed/di", "@tsed/schema", "mongodb"]
});
```

### vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80
      }
    }
  }
});
```

### vitest.unit.config.ts

```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 5_000
  }
});
```

---

## References

- [@tsed/bullmq source](https://github.com/tsedio/tsed/tree/production/packages/third-parties/bullmq)
- [@tsed/agenda source](https://github.com/tsedio/tsed/tree/production/packages/third-parties/agenda)
- [Ts.ED Testing Documentation](https://tsed.io/docs/testing.html)
- [Ts.ED Providers Documentation](https://tsed.io/docs/providers.html)
- [@monque/core](../core/)
