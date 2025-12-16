# Research: Monque Job Scheduler Library

**Feature**: 001-monque-scheduler  
**Date**: 2025-12-16  
**Status**: Complete

## Research Tasks

### 1. MongoDB Atomic Locking Patterns

**Task**: Research best practices for atomic job locking in MongoDB to prevent duplicate processing.

**Decision**: Use `findOneAndUpdate` with atomic query conditions.

**Rationale**: MongoDB's `findOneAndUpdate` is atomic at the document level, meaning the find and update happen as a single operation. This prevents race conditions where multiple workers could claim the same job. The operation returns the document before or after modification, confirming whether the lock was acquired.

**Pattern**:
```typescript
const job = await collection.findOneAndUpdate(
  { 
    status: 'pending', 
    nextRunAt: { $lte: new Date() },
    // Optional: exclude jobs locked by other workers
  },
  { 
    $set: { 
      status: 'processing', 
      lockedAt: new Date() 
    } 
  },
  { 
    returnDocument: 'after',
    sort: { nextRunAt: 1 }  // Process oldest jobs first
  }
);
```

**Alternatives considered**:
- Two-phase locking (find then update): Rejected due to race condition window
- Optimistic locking with version field: Adds complexity without benefit for this use case
- Redis-based distributed locks: Adds external dependency, MongoDB sufficient for this scale

---

### 2. Exponential Backoff Implementation

**Task**: Research exponential backoff formula and best practices for retry strategies.

**Decision**: Use formula `nextRunAt = now + (2^failCount × baseInterval)` with configurable base interval and max retries.

**Rationale**: Exponential backoff is the industry standard for retry strategies. It prevents overwhelming failing services while still providing reasonable retry windows. The 2^n growth rate provides good balance between quick initial retries and longer delays for persistent failures.

**Implementation details**:
- Base interval: 1 second (configurable)
- Formula: `delay = Math.pow(2, failCount) * baseInterval`
- Max retries: 10 (configurable) → max delay ~17 minutes
- After max retries: Mark job as permanently `failed`

**Alternatives considered**:
- Linear backoff: Rejected, doesn't provide adequate spacing for persistent failures
- Jitter/randomization: Could be added as enhancement, not critical for v1
- Fibonacci backoff: More complex without significant benefit

---

### 3. Cron Expression Parsing

**Task**: Research cron parsing libraries for Node.js.

**Decision**: Use `cron-parser` library.

**Rationale**: `cron-parser` is the most popular and well-maintained cron parsing library for Node.js. It supports standard 5-field cron expressions, provides `next()` iteration for calculating future run times, and handles edge cases like DST transitions.

**Key features used**:
- `parseExpression(cronString)` - Parse cron expression
- `expression.next()` - Get next occurrence
- Error handling for invalid expressions

**Alternatives considered**:
- `node-cron`: More focused on scheduling, less flexible for just parsing
- `cron`: Lower-level, requires more manual work
- Custom parser: Unnecessary complexity

---

### 4. EventEmitter Pattern for Job Lifecycle

**Task**: Research Node.js EventEmitter patterns for observability.

**Decision**: Extend native `EventEmitter` class in the `Monque` class.

**Rationale**: Node.js's built-in `EventEmitter` is lightweight, well-understood, and provides all needed functionality. No need for external libraries. Typed events can be achieved through TypeScript declaration merging.

**Events defined**:
- `job:start` - Emitted when a job begins processing
- `job:complete` - Emitted when a job finishes successfully
- `job:fail` - Emitted when a job fails (will retry)
- `job:error` - Emitted for unexpected errors during processing

**Type safety approach**:
```typescript
interface MonqueEvents {
  'job:start': (job: IJob) => void;
  'job:complete': (job: IJob, duration: number) => void;
  'job:fail': (job: IJob, error: Error) => void;
  'job:error': (error: Error, job?: IJob) => void;
}
```

---

### 5. Ts.ED Decorator and Module Patterns

**Task**: Research Ts.ED module creation and decorator patterns for framework integration.

**Decision**: Create a `@Module` decorated class for configuration and `@Job` decorator for worker registration.

**Rationale**: Ts.ED follows a decorator-based architecture similar to Angular and NestJS. Creating framework-specific decorators that leverage Ts.ED's DI container provides the most idiomatic integration.

**Module pattern**:
```typescript
@Module()
export class MonqueModule {
  static forRoot(options: MonqueModuleOptions): ModuleAsyncOptions {
    return {
      module: MonqueModule,
      providers: [/* ... */]
    };
  }
}
```

**Decorator pattern**:
```typescript
export function Job(options: JobOptions): ClassDecorator {
  return (target) => {
    // Store metadata and register with DI
    Reflect.defineMetadata(JOB_METADATA_KEY, options, target);
    registerProvider({ provide: target, useClass: target });
  };
}
```

**Alternatives considered**:
- Provider-only approach: Less idiomatic for Ts.ED
- Standalone functions: Loses DI benefits

---

### 6. Mongoose vs Native MongoDB Integration

**Task**: Research how to support both Mongoose Connection and native MongoDB Db instances.

**Decision**: Detect connection type at runtime and extract native `Db` from Mongoose if needed.

**Rationale**: Mongoose wraps the native driver. The `connection.db` property provides access to the underlying native `Db` instance. This allows supporting both without code duplication in the core library.

**Detection logic**:
```typescript
function extractDb(connection: unknown): Db {
  if (connection instanceof Db) {
    return connection;
  }
  // Mongoose Connection has .db property
  if (typeof connection === 'object' && connection !== null && 'db' in connection) {
    return (connection as { db: Db }).db;
  }
  throw new Error('Invalid connection type');
}
```

---

### 7. Graceful Shutdown Implementation

**Task**: Research patterns for graceful shutdown with in-progress job completion.

**Decision**: Track active jobs with a Set/counter, stop polling loop, wait for completion with timeout.

**Rationale**: Graceful shutdown requires: (1) stopping new work pickup, (2) waiting for current work to finish, (3) timing out if work takes too long. A Promise-based approach allows callers to await shutdown completion.

**Implementation approach**:
```typescript
class Monque {
  private activeJobs = new Set<string>();
  private isRunning = false;
  
  async stop(timeout = 30000): Promise<void> {
    this.isRunning = false;  // Stop polling
    
    if (this.activeJobs.size === 0) return;
    
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`Shutdown timeout: ${this.activeJobs.size} jobs still running`);
        resolve();
      }, timeout);
      
      // Poll until all jobs complete or timeout
      const checkComplete = setInterval(() => {
        if (this.activeJobs.size === 0) {
          clearTimeout(timer);
          clearInterval(checkComplete);
          resolve();
        }
      }, 100);
    });
  }
}
```

---

### 8. tsdown Build Configuration

**Task**: Research tsdown configuration for dual ESM/CJS output with TypeScript declarations.

**Decision**: Configure tsdown with multiple entry points and format options.

**Rationale**: tsdown (built on esbuild and rollup-plugin-dts) provides fast builds with proper dual-format output. It handles the complexity of generating both ESM and CJS while maintaining correct `package.json` exports.

**Configuration**:
```typescript
// tsdown.config.ts
export default {
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  outDir: 'dist'
};
```

**package.json exports**:
```json
{
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

---

## Summary

All technical unknowns have been resolved. The implementation can proceed with:

1. **Atomic locking**: `findOneAndUpdate` for race-condition-free job claiming
2. **Backoff**: `2^failCount × baseInterval` with configurable limits
3. **Cron**: `cron-parser` library for expression parsing
4. **Events**: Native `EventEmitter` with typed events
5. **Ts.ED**: Module + decorator pattern following framework conventions
6. **Connection flexibility**: Runtime detection supporting Mongoose and native driver
7. **Shutdown**: Promise-based with timeout and active job tracking
8. **Build**: tsdown for dual ESM/CJS with TypeScript declarations
