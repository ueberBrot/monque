# Research: @monque/tsed Integration

**Feature**: 003-tsed-integration
**Date**: 2026-01-22

## Research Summary

This document captures research findings that informed the technical design of the `@monque/tsed` package.

---

## 1. Ts.ED Integration Patterns

### Decision: Follow `@tsed/bullmq` patterns

**Rationale**: The `@tsed/bullmq` package is the official reference implementation for job queue integrations in Ts.ED. Following its patterns ensures consistency with the Ts.ED ecosystem and reduces learning curve for developers familiar with other Ts.ED integrations.

**Key patterns adopted from `@tsed/bullmq`**:

1. **Module as Provider Type**: Use `injectable(Class).type(ProviderType.MODULE)` for the main module
2. **Store for Metadata**: Use `StoreMerge(SYMBOL, metadata)` to attach decorator metadata
3. **Provider Types**: Define custom provider types for different component categories
4. **Lifecycle Hooks**: Implement `OnInit` and `OnDestroy` interfaces for startup/shutdown
5. **DIContext per Job**: Create isolated DI context for each job execution using `runInContext()`

**Alternatives considered**:
- Custom DI system: Rejected - would fragment the ecosystem
- Direct Monque usage without decorators: Rejected - loses Ts.ED DI benefits

---

## 2. Decorator Architecture

### Decision: Class + Method decorators with namespace support

**Rationale**: Combining class-level `@JobController` with method-level `@Job`/`@Cron` decorators allows grouping related jobs
 while maintaining clean separation of concerns. The namespace concept (from PLAN.md) prefixes job names for organization.

**Implementation approach**:

```typescript
// Class decorator stores controller metadata
@JobController("email")  // namespace = "email"
export class EmailJobs {
  @Job("send")  // Registered as "email.send"

  async send(job: Job<EmailPayload>) { }
}
```

**Key design decisions**:
- `@JobController(namespace?)` - Optional namespace prefix
- `@Job(name, options?)` - Job handler, full name is `${namespace}.${name}` or just `name`
- `@Cron(pattern, options?)` - Scheduled jobs with cron expressions

**Alternatives considered**:
- Single `@Job` decorator per class (like `@tsed/bullmq`): Rejected - doesn't match PLAN.md API design
- Separate files per worker: Rejected - less convenient for grouping related jobs

---

## 3. Database Resolution Strategy

### Decision: Three-strategy resolution (db, dbFactory, dbToken)

**Rationale**: Different applications have different MongoDB connection patterns. Supporting all three ensures maximum flexibility:

1. **Direct `db`**: For simple cases where Db instance is available
2. **Factory `dbFactory`**: For async connection setup
3. **DI Token `dbToken`**: For existing DI-managed connections

**Implementation**:

```typescript
export async function resolveDatabase(
  config: MonqueTsedConfig,
  injectorFn?: <T>(token: TokenProvider<T>) => T
): Promise<Db> {
  if (config.db) return config.db;
  if (config.dbFactory) return config.dbFactory();
  if (config.dbToken) {
    const db = injectorFn?.(config.dbToken as TokenProvider<Db>);
    if (!db) throw new Error(`Could not resolve database from token`);
    return db;
  }
  throw new Error("MonqueTsedConfig requires 'db', 'dbFactory', or 'dbToken'");
}
```

**Alternatives considered**:
- Only DI token: Rejected - adds complexity for simple use cases
- Only factory: Rejected - doesn't integrate well with existing DI setups

---

## 4. Job Execution Isolation (FR-006)

### Decision: Create new DIContext per job execution

**Rationale**: The feature spec requires "discrete Dependency Injection Context for every job execution to ensure state isolation" (FR-006). This matches how `@tsed/bullmq` handles job execution via `runInContext()`.

**Implementation approach**:

```typescript
private async executeJob(workerInstance: any, methodName: string, job: Job) {
  const $ctx = new DIContext({
    id: job._id?.toString() ?? randomUUID(),
    level: "info",
    additionalProps: {
      logType: "monque",
      jobName: job.name,
      jobId: job._id?.toString()
    }
  });
  
  $ctx.set("MONQUE_JOB", job);
  
  try {
    return await runInContext($ctx, () => {
      return workerInstance[methodName](job);
    });
  } finally {
    await $ctx.destroy();
  }
}
```

**Benefits**:
- Request-scoped services get fresh instances per job
- Job context is available via `@Context()` decorator
- Proper cleanup after job completion

**Alternatives considered**:
- Singleton context for all jobs: Rejected - violates isolation requirement (FR-006)
- Manual cleanup without context: Rejected - error-prone and inconsistent

---

## 5. Job Registration Flow

**Rationale**: Following `@tsed/bullmq`, jobs are discovered by scanning providers with specific types during `$onInit`. This enables declarative registration without explicit configuration.

**Flow**:
1. `@JobController` registers class with type `ProviderTypes.JOB_CONTROLLER`
2. `@Job`/`@Cron` decorators store method metadata via `Store.from(target.constructor)`
3. `MonqueModule.$onInit()` collects all `JOB_CONTROLLER` providers
4. For each provider, extract metadata and call `monque.register()`

**Alternatives considered**:
- Explicit job array in config: Rejected - less ergonomic than decorator discovery

- Runtime dynamic registration: Rejected - loses static analysis benefits

---

## 6. Cron Job Handling

### Decision: Cron jobs are jobs with repeatInterval

**Rationale**: In `@monque/core`, scheduled jobs use `monque.schedule(cron, name, data)` which sets `repeatInterval`. The `@Cron` decorator should trigger the same behavior.

**Implementation**:
- `@Cron(pattern, options)` stores cron pattern in metadata
- During `$onInit`, cron jobs are both registered as jobs AND scheduled
- Job handles execution; Monque handles rescheduling

**Alternatives considered**:
- Separate cron scheduler: Rejected - duplicates Monque's built-in scheduling
- No automatic scheduling: Rejected - would require manual `schedule()` calls

---

## 7. Testing Strategy

### Decision: Use `@tsed/testcontainers-mongo` for integration tests

**Rationale**: The official `@tsed/testcontainers-mongo` package provides a standardized way to spin up MongoDB containers for Ts.ED integration tests. Using this ensures compatibility with Ts.ED's testing utilities and reduces boilerplate code for container management.

**Test categories**:
1. **Unit tests** (`tests/unit/`):
   - Decorator metadata attachment
   - Service methods with mocked Monque
   - Utility functions

2. **Integration tests** (`tests/integration/`):
   - Full DI bootstrap with PlatformTest
   - Worker registration and invocation
   - Cron job scheduling
   - Uses `TestContainersMongo` for real database interaction

**Patterns**:
```typescript
// Vitest Configuration
export default defineConfig({
  test: {
    globalSetup: [import.meta.resolve("@tsed/testcontainers-mongo/vitest/setup")]
  }
});

// Integration test pattern
import { TestContainersMongo } from "@tsed/testcontainers-mongo";

describe("Integration", () => {
  beforeEach(async () => {
    await TestContainersMongo.create();
    // Get connection details if needed
    const { url } = TestContainersMongo.getMongoConnectionOptions();
    await PlatformTest.create({ 
       monque: { url, ... } 
    });
  });
  afterEach(async () => {
    await TestContainersMongo.reset(); // cleans collections
    await PlatformTest.reset();
  });
});
```

---

## 8. Package Naming and Marketplace

### Decision: Package name `@monque/tsed`

**Rationale**: While the spec mentions `tsed-plugin-monque` for marketplace discovery (FR-002), the PLAN.md explicitly specifies `@monque/tsed` which:
- Follows monorepo naming convention (`@monque/*`)
- Is consistent with `@monque/core`
- Can still be discovered via keywords and description

**Marketplace compliance**:
- Add keywords: `["tsed", "tsed-plugin", "job-queue", "mongodb", "monque"]`
- Add description mentioning Ts.ED

**Alternatives considered**:
- `tsed-plugin-monque`: Rejected - breaks monorepo naming convention
- `@tsed/monque`: Rejected - not part of Ts.ED organization

---

## Summary

All technical unknowns have been resolved. The design follows established Ts.ED patterns from `@tsed/bullmq` while adapting to Monque's API and the specific requirements in PLAN.md.

---

## 9. Error Handling & Startup Behavior

### Decision: Fail-fast on startup errors, graceful per-job errors

**Rationale**: Critical configuration/connection errors should prevent startup to ensure developers discover issues immediately. However, individual job execution failures should not crash the worker.

**Startup behavior**:
- If Monque connection fails during `$onInit` → throw error, abort startup
- If duplicate queue names are registered → throw error at startup with clear message
- If database resolution strategy is invalid → throw error at startup

**Runtime behavior**:
- If DI resolution fails during job execution → mark job as failed, log error, continue worker
- If job handler throws → standard Monque failure behavior (mark failed, respect retry policy)

**Implementation**:

```typescript
// In MonqueModule.$onInit()
async $onInit(): Promise<void> {
  // Validate no duplicate registrations
  const jobNames = new Set<string>();
  for (const provider of jobControllers) {
    const store = Store.from(provider.useClass).get<JobStore>(MONQUE);
    for (const job of store.jobs) {
      const fullName = buildJobName(store.namespace, job.name);
      if (jobNames.has(fullName)) {
        throw new Error(`Duplicate job registration: "${fullName}" is registered by multiple controllers`);
      }
      jobNames.add(fullName);
    }
  }

  // Connection failure will throw and abort startup
  await this.monque.initialize();
}

// In job execution wrapper
private async executeJob(workerInstance: any, methodName: string, job: Job) {
  try {
    const $ctx = new DIContext({ /* ... */ });
    return await runInContext($ctx, async () => {
      // DI resolution happens here - may throw
      return workerInstance[methodName](job);
    });
  } catch (error) {
    // Log error using Ts.ED logger, let Monque handle job failure
    this.logger.error({ jobId: job._id, error }, "Job execution failed");
    throw error; // Re-throw so Monque marks job as failed
  }
}
```

**Alternatives considered**:
- Warn on duplicate and use last-registered: Rejected - silent behavior leads to confusion
- Retry connection on startup: Rejected - adds complexity; Docker/K8s handles restart

---

## 10. Observability

### Decision: Use Ts.ED native logger

**Rationale**: Integrating with Ts.ED's existing logger provides consistency with other Ts.ED packages and allows users to configure log levels via Ts.ED's standard configuration.

**Log levels**:
- **error**: Job failures, DI resolution errors, connection failures
- **warn**: Deprecation notices, configuration issues that fall back to defaults
- **info**: Module initialization, worker registration summary, graceful shutdown

**Implementation**:

```typescript
import { Logger } from "@tsed/common";

@Module()
export class MonqueModule implements OnInit, OnDestroy {
  @Inject()
  private logger: Logger;

  async $onInit() {
    this.logger.info(`Monque: Registering ${jobCount} jobs...`);
    // ...
    this.logger.info(`Monque: Started with ${jobCount} jobs`);
  }

  async $onDestroy() {
    this.logger.info("Monque: Initiating graceful shutdown...");
    await this.monque.stop();
    this.logger.info("Monque: Shutdown complete");
  }
}
```

**Alternatives considered**:
- Custom logger: Rejected - fragments logging configuration
- No logging: Rejected - hinders debugging and operational visibility
