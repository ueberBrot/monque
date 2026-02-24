# Testing Patterns

**Analysis Date:** 2026-02-24

## Test Framework

**Runner:**
- Vitest 4.x with `globals: true` (no need to import `describe`, `it`, `expect`, `vi`, `beforeAll`, etc.)
- Environment: `node`
- Config: `packages/core/vitest.config.ts` (main), `packages/core/vitest.unit.config.ts` (unit-only)
- Config: `packages/tsed/vitest.config.ts` (Ts.ED package)

**Assertion Library:**
- Vitest built-in `expect` (Jest-compatible API)
- Uses `toEqual`, `toMatchObject`, `toThrow`, `toHaveBeenCalledWith`, `toBeInstanceOf`, etc.

**Run Commands:**
```bash
# From repo root (via Turborepo)
bun run test              # All tests across all packages
bun run test:unit         # Unit tests only across all packages
bun run test:integration  # Integration tests only
bun run test:core         # All tests for @monque/core
bun run test:unit:core    # Unit tests for @monque/core only
bun run test:dev          # Watch mode

# From package directory (packages/core/)
bun run test src/scheduler/services/job-processor.test.ts   # Single file
bun run test:unit tests/unit/backoff.test.ts                # Single unit test
```

## Test File Organization

**Location:** Tests live in a separate `tests/` directory, NOT colocated with source files.

**Naming:** `{source-name}.test.ts` — mirrors source file names in kebab-case.

**Structure:**
```
packages/core/tests/
├── unit/                          # Pure logic tests (no DB, mocked context)
│   ├── backoff.test.ts            # Tests for src/shared/utils/backoff.ts
│   ├── cron.test.ts               # Tests for src/shared/utils/cron.ts
│   ├── errors.test.ts             # Tests for src/shared/errors.ts
│   ├── guards.test.ts             # Tests for src/jobs/guards.ts
│   └── services/                  # Tests for src/scheduler/services/
│       ├── job-processor.test.ts
│       ├── job-manager.test.ts
│       ├── job-scheduler.test.ts
│       ├── job-query-service.test.ts
│       └── change-stream-handler.test.ts
├── integration/                   # Full flow tests with real MongoDB
│   ├── enqueue.test.ts
│   ├── schedule.test.ts
│   ├── process.test.ts
│   ├── cancel.test.ts
│   ├── query.test.ts
│   ├── events.test.ts
│   ├── error-handling.test.ts
│   └── concurrent.test.ts
├── factories/                     # Test data factories
│   ├── job.factory.ts             # fishery-based JobFactory
│   ├── context.ts                 # Mock SchedulerContext factory
│   └── index.ts                   # Factory barrel exports
└── setup/                         # Test infrastructure
    ├── global-setup.ts            # Testcontainers lifecycle (globalSetup/teardown)
    ├── mongodb.ts                 # MongoDB singleton container manager
    ├── test-utils.ts              # Shared test helpers
    ├── constants.ts               # Shared test constants
    ├── seed.ts                    # Faker seed (setupFile)
    └── index.ts                   # Setup barrel exports
```

**Ts.ED package tests:**
```
packages/tsed/tests/
├── unit/
│   └── decorators/
│       ├── job.test.ts
│       ├── cron.test.ts
│       └── job-controller.test.ts
├── integration/
│   └── module.test.ts
└── test-utils.ts                  # Bootstrap helpers for Ts.ED DI
```

## Test Structure

**Suite Organization:**
```typescript
/**
 * Tests for JobProcessor service.
 * Covers job picking, execution, completion, failure handling, and heartbeat.
 * @see {@link packages/core/src/scheduler/services/job-processor.ts}
 */
describe('JobProcessor', () => {
	let processor: JobProcessor;
	let ctx: ReturnType<typeof createMockContext>;

	beforeEach(() => {
		ctx = createMockContext();
		processor = new JobProcessor(ctx);
	});

	describe('pickAndProcessJob', () => {
		it('should pick a pending job and execute the worker', async () => {
			// Arrange
			const job = JobFactory.pending();
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(job);
			ctx.getWorker.mockReturnValueOnce({ handler: vi.fn().mockResolvedValueOnce(undefined) });

			// Act
			const result = await processor.pickAndProcessJob();

			// Assert
			expect(result).toBe(true);
			expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
				expect.objectContaining({ status: JobStatus.PENDING }),
				expect.any(Object),
				expect.any(Object),
			);
		});

		it('should return false when no jobs are available', async () => {
			vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(null);

			const result = await processor.pickAndProcessJob();

			expect(result).toBe(false);
		});
	});
});
```

**Patterns:**
- **File-level JSDoc**: Each test file starts with a JSDoc block describing coverage scope and `@see` link
- **Top-level `describe`**: Named after the class/module under test
- **Nested `describe`**: Named after the method or behavior group
- **`it('should ...')`**: Descriptive present-tense assertions
- **Arrange/Act/Assert**: Implicit structure (no comments needed if obvious)
- **`beforeEach`**: Create fresh mock context and service instance per test
- **`afterEach`**: Clean up instances, restore timers (`vi.useRealTimers()`)

## Mocking

**Framework:** Vitest built-in (`vi.fn()`, `vi.spyOn()`, `vi.mock()`)

**Primary pattern — spying on mock collection methods:**
```typescript
const ctx = createMockContext();
vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(job);
vi.spyOn(ctx.mockCollection, 'updateOne').mockResolvedValueOnce({ modifiedCount: 1 });
vi.spyOn(ctx.mockCollection, 'find').mockReturnValueOnce({
	toArray: vi.fn().mockResolvedValueOnce([job1, job2]),
} as any);
```

**Mock return helpers:**
- `mockResolvedValueOnce(value)` — single async return
- `mockReturnValueOnce(value)` — single sync return
- `mockRejectedValueOnce(error)` — simulate async failure
- `mockImplementation(fn)` — custom behavior

**Fake timers (for time-dependent tests like backoff, polling):**
```typescript
beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

it('should calculate exponential backoff', () => {
	vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
	const result = calculateNextRetryAt(3);
	expect(result.getTime()).toBeGreaterThan(Date.now());
});
```

**What to mock (unit tests):**
- MongoDB collection methods (`findOneAndUpdate`, `updateOne`, `find`, `countDocuments`, `aggregate`)
- Worker handlers (registered via `ctx.getWorker`)
- Event emission (verified via `ctx.emit` spy or `ctx.emitHistory`)
- Timers and dates (`vi.useFakeTimers`, `vi.setSystemTime`)

**What NOT to mock (integration tests):**
- MongoDB operations — use real Testcontainers MongoDB
- The Monque class itself — test full lifecycle
- Job processing flow — test end-to-end

## Fixtures and Factories

**Factory library:** `fishery` with `@faker-js/faker`

**Job Factory (`packages/core/tests/factories/job.factory.ts`):**
```typescript
import { Factory } from 'fishery';
import { faker } from '@faker-js/faker';

export const JobFactory = Factory.define<JobDocument>(({ sequence, transientParams }) => ({
	_id: new ObjectId(),
	name: transientParams.name ?? `job-${sequence}`,
	data: transientParams.data ?? { key: faker.string.alphanumeric(10) },
	status: transientParams.status ?? JobStatus.PENDING,
	attempts: 0,
	maxAttempts: 3,
	createdAt: new Date(),
	updatedAt: new Date(),
	scheduledAt: new Date(),
	// ... other fields
}));
```

**Status-specific helpers (`JobFactoryHelpers` or `JobFactory` methods):**
```typescript
JobFactory.pending();                    // status: 'pending'
JobFactory.processing();                 // status: 'processing', pickedAt set
JobFactory.completed();                  // status: 'completed', completedAt set
JobFactory.failed();                     // status: 'failed', failedAt + error set
JobFactory.build({ name: 'custom' });    // Override specific fields
```

**Mock Context Factory (`packages/core/tests/factories/context.ts`):**
```typescript
export function createMockContext(): MockSchedulerContext {
	const emitHistory: Array<{ event: string; args: unknown[] }> = [];

	const mockCollection = {
		findOneAndUpdate: vi.fn(),
		updateOne: vi.fn(),
		updateMany: vi.fn(),
		find: vi.fn(),
		findOne: vi.fn(),
		countDocuments: vi.fn(),
		aggregate: vi.fn(),
		createIndex: vi.fn(),
		// ... all Collection methods as vi.fn()
	};

	return {
		collection: mockCollection as unknown as Collection<JobDocument>,
		mockCollection,  // Direct access for vi.spyOn
		options: { /* full default options */ },
		emit: vi.fn((...args) => {
			emitHistory.push({ event: args[0], args: args.slice(1) });
			return true;
		}),
		emitHistory,     // For asserting emitted events
		getWorker: vi.fn(),
		registerWorker: vi.fn(),
	};
}
```

**Faker seed (`packages/core/tests/setup/seed.ts`):**
```typescript
import { faker } from '@faker-js/faker';
faker.seed(123456);
```
- Referenced as `setupFiles` in vitest config — runs before all test files
- Ensures deterministic fake data across test runs

## Test Isolation

**Unit tests:**
- Fresh `createMockContext()` in each `beforeEach` — no shared state between tests
- Each test gets its own service instance
- Fake timers restored in `afterEach`

**Integration tests — per-suite database isolation:**
```typescript
// packages/core/tests/setup/test-utils.ts

/** Get a fresh database for a test suite */
export function getTestDb(suiteName: string): Db {
	const client = getMongoClient();  // Shared connection from container
	return client.db(`test-${suiteName}-${Date.now()}`);
}

/** Generate a unique collection name to avoid conflicts */
export function uniqueCollectionName(): string {
	return `jobs-${randomUUID().slice(0, 8)}`;
}

/** Clear all documents from a collection */
export async function clearCollection(collection: Collection): Promise<void> {
	await collection.deleteMany({});
}

/** Drop the test database after suite completes */
export async function cleanupTestDb(db: Db): Promise<void> {
	await db.dropDatabase();
}
```

**Integration test lifecycle:**
```typescript
describe('Enqueue Integration', () => {
	let db: Db;
	let monque: Monque;

	beforeAll(async () => {
		db = getTestDb('enqueue');
	});

	afterEach(async () => {
		await stopMonqueInstances(monque);
	});

	afterAll(async () => {
		await cleanupTestDb(db);
	});

	it('should enqueue a job', async () => {
		monque = new Monque({ db, collectionName: uniqueCollectionName() });
		await monque.initialize();
		// ... test logic
	});
});
```

## Integration Test Infrastructure

**Testcontainers setup (`packages/core/tests/setup/global-setup.ts`):**
```typescript
// Global setup — starts MongoDB container once for all tests
export async function setup() {
	const container = await new MongoDBContainer('mongo:8').start();
	process.env['MONGO_URI'] = container.getConnectionString();
	return async () => {
		await container.stop();
	};
}
```

**MongoDB singleton (`packages/core/tests/setup/mongodb.ts`):**
- Manages a single `MongoClient` connection shared across all integration tests
- Lazy initialization on first `getMongoClient()` call
- Connection string from `process.env.MONGO_URI` (set by global setup)
- Container reuse supported via `TESTCONTAINERS_REUSE_ENABLE=true`

**Vitest config for integration (`packages/core/vitest.config.ts`):**
```typescript
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		testTimeout: 30000,        // 30s per test (container ops are slow)
		hookTimeout: 60000,        // 60s for beforeAll/afterAll (container startup)
		globalSetup: ['./tests/setup/global-setup.ts'],
		setupFiles: ['./tests/setup/seed.ts'],
		include: ['tests/**/*.test.ts'],
	},
});
```

**Unit-only config (`packages/core/vitest.unit.config.ts`):**
```typescript
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		testTimeout: 5000,         // 5s — no DB, should be fast
		setupFiles: ['./tests/setup/seed.ts'],
		include: ['tests/unit/**/*.test.ts'],
		// NO globalSetup — no container needed
	},
});
```

## Test Utilities

**Location:** `packages/core/tests/setup/test-utils.ts`

**`waitFor(fn, options?)` — Polling helper for async assertions:**
```typescript
/** Poll until fn() resolves truthy, or timeout */
export async function waitFor(
	fn: () => Promise<boolean> | boolean,
	options?: { timeout?: number; interval?: number },
): Promise<void>;

// Usage:
await waitFor(async () => {
	const job = await collection.findOne({ name: 'test-job' });
	return job?.status === 'completed';
}, { timeout: 10000, interval: 100 });
```

**`stopMonqueInstances(...instances)` — Graceful shutdown:**
```typescript
/** Stop one or more Monque instances, ignoring errors */
export async function stopMonqueInstances(...instances: (Monque | undefined)[]): Promise<void>;

// Usage in afterEach:
afterEach(async () => {
	await stopMonqueInstances(monque1, monque2);
});
```

**`triggerJobImmediately(collection, jobName)` — Force job to be picked up:**
```typescript
/** Set scheduledAt to now so the job is immediately eligible for processing */
export async function triggerJobImmediately(
	collection: Collection<JobDocument>,
	jobName: string,
): Promise<void>;
```

**`findJobByQuery(collection, query)` — Find job with assertion:**
```typescript
/** Find a single job matching query, throws if not found */
export async function findJobByQuery(
	collection: Collection<JobDocument>,
	query: Filter<JobDocument>,
): Promise<JobDocument>;
```

## Coverage

**Provider:** V8 (via Vitest)

**Thresholds (enforced in `packages/core/vitest.config.ts`):**
```typescript
coverage: {
	provider: 'v8',
	thresholds: {
		lines: 85,
		functions: 85,
		statements: 85,
		branches: 75,
	},
	exclude: [
		'**/index.ts',     // Barrel files
		'**/types.ts',     // Type-only files
		'**/*.config.*',   // Config files
		'tests/**',        // Test files themselves
	],
},
```

**Run coverage:**
```bash
bun run test -- --coverage     # Full coverage report
```

## Timeouts

| Context | Timeout | Reason |
|---------|---------|--------|
| Unit test (`testTimeout`) | 5,000ms | No I/O, pure logic |
| Integration test (`testTimeout`) | 30,000ms | Real MongoDB operations |
| Hook timeout (`hookTimeout`) | 60,000ms | Container startup in `beforeAll` |
| `waitFor` default | 10,000ms | Polling for async state changes |
| `waitFor` interval | 100ms | Poll frequency |

## Test Types

**Unit Tests (`tests/unit/`):**
- Test individual services/functions in isolation
- All external dependencies mocked via `createMockContext()`
- No database, no network, no containers
- Fast: 5s timeout
- Cover: business logic, error handling, edge cases, input validation

**Integration Tests (`tests/integration/`):**
- Test full Monque lifecycle with real MongoDB
- Real database operations via Testcontainers
- Test: enqueue/schedule/process/cancel flows, concurrent processing, event emission
- Slower: 30s timeout
- Cover: database interactions, atomic operations, race conditions, end-to-end flows

**E2E Tests:**
- Not present in the codebase currently

## Common Patterns

**Async testing:**
```typescript
it('should complete the job after processing', async () => {
	const monque = new Monque({ db, collectionName: uniqueCollectionName() });
	await monque.initialize();
	monque.registerWorker('test', async (data) => {
		// worker logic
	});
	await monque.enqueue('test', { key: 'value' });
	await monque.start();

	await waitFor(async () => {
		const job = await findJobByQuery(collection, { name: 'test' });
		return job.status === JobStatus.COMPLETED;
	});

	const job = await findJobByQuery(collection, { name: 'test' });
	expect(job.status).toBe(JobStatus.COMPLETED);
});
```

**Error testing:**
```typescript
it('should throw InvalidCronError for bad expression', () => {
	expect(() => validateCron('not-a-cron')).toThrow(InvalidCronError);
	expect(() => validateCron('not-a-cron')).toThrow(/Invalid cron expression/);
});

it('should throw MonqueError if not initialized', async () => {
	const monque = new Monque({ db });
	await expect(monque.enqueue('test', {})).rejects.toThrow(MonqueError);
	await expect(monque.enqueue('test', {})).rejects.toThrow(/not initialized/);
});
```

**Event assertion testing (using emitHistory):**
```typescript
it('should emit job:completed event', async () => {
	// ... trigger job completion

	const completedEvents = ctx.emitHistory.filter((e) => e.event === 'job:completed');
	expect(completedEvents).toHaveLength(1);
	expect(completedEvents[0]?.args[0]).toMatchObject({
		name: 'test-job',
		status: JobStatus.COMPLETED,
	});
});
```

**Mock verification:**
```typescript
it('should update job status to processing atomically', async () => {
	vi.spyOn(ctx.mockCollection, 'findOneAndUpdate').mockResolvedValueOnce(job);

	await processor.pickAndProcessJob();

	expect(ctx.mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
		expect.objectContaining({
			status: JobStatus.PENDING,
			scheduledAt: expect.objectContaining({ $lte: expect.any(Date) }),
		}),
		expect.objectContaining({
			$set: expect.objectContaining({ status: JobStatus.PROCESSING }),
		}),
		expect.objectContaining({ returnDocument: 'after' }),
	);
});
```

## Path Aliases in Tests

Configured in `packages/core/tsconfig.json` and resolved by Vitest:

| Alias | Maps to | Example |
|-------|---------|---------|
| `@/` | `./src/` | `import { JobStatus } from '@/jobs'` |
| `@tests/` | `./tests/` | `import { JobFactory } from '@tests/factories'` |
| `@test-utils/` | `./tests/setup/` | `import { createMockContext } from '@test-utils'` |

**Note:** Path alias imports do NOT use `.js` extensions. Relative imports in source DO use `.js` extensions.

---

*Testing analysis: 2026-02-24*
