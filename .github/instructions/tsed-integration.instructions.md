---
applyTo: "packages/tsed/src/**/*.ts"
---
# Ts.ED Integration Instructions

You are working on `@monque/tsed`, a Ts.ED framework integration for the core scheduler.

## Rules

- This package depends on `@monque/core`.
- Use Ts.ED decorators (`@Module`, `@Injectable`, `@Inject`).
- Workers MUST be resolved via Ts.ED's DI container.

## Package Manager

Use `bun` for all package management and script execution tasks.

```bash
# Install dependencies
bun install

# Run scripts
bun run build
bun run test
bun run lint
```

## Module Setup

`MonqueModule` registers the `Monque` instance as a provider:

```typescript
@Module({})
export class MonqueModule {
  constructor(@Inject() private injector: InjectorService) {}

  async $onInit(): Promise<void> {
    // Scan for @Job decorated classes and register them
  }
}
```

## Hybrid Connection Support

The module MUST support both Mongoose and native MongoDB connections:

```typescript
function extractDb(connection: unknown): Db {
  if (connection && typeof connection === 'object' && 'db' in connection) {
    // Mongoose connection
    return (connection as { db: Db }).db;
  }
  return connection as Db;
}
```

## @Job Decorator

Implement a `@Job` decorator to mark classes as workers:

```typescript
export function Job(options: { name: string }): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('monque:job', options, target);
  };
}
```

## Worker Execution with DI

When a job triggers, resolve the worker class via the injector:

```typescript
const instance = this.injector.get<WorkerClass>(WorkerClass);
await instance.handle(job.data);
```

This ensures all `@Inject()` dependencies are available inside the worker.

