# Plan

## Tech Stack & Constraints

| Category        | Technology     | Purpose                                        |
| --------------- | -------------- | ---------------------------------------------- |
| Monorepo        | Turborepo      | Build orchestration and caching                |
| Package Manager | Bun            | Workspace management and dependency resolution |
| Bundler         | tsdown         | ESM/CJS generation and type definitions        |
| Testing         | Vitest         | Unit testing with UI and coverage              |
| Local Services  | Docker Compose | Local MongoDB instance for testing             |
| Linting         | Biome          | Fast linting and formatting                    |
| Versioning      | Changesets     | Semantic versioning with GitHub Actions        |
| Language        | TypeScript     | Strict type safety                             |

---

## Implementation Plan

### Phase 1: Project Structure & Tooling

Set up the root files for a Turbo monorepo.

#### Tasks

1. **Workspace Configuration**
   - Configure `bun` workspaces for `./packages/*`
   - Set up Turborepo pipeline configuration

2. **Linting Setup**
   - Initialize Biome for the root
   - Configure formatting and linting rules

3. **Release Pipeline**
   - Initialize `changesets`
   - Create `.github/workflows/release.yml`
   - Configure `changesets/action` for NPM/GitHub Package Registry publishing

4. **Local Development Services**
   - Create `docker-compose.yml` with MongoDB service
   - Configure MongoDB on port 27017
   - Add npm scripts for starting/stopping services (`bun run services:up`, `bun run services:down`)

---

### Phase 2: Package A - `@monque/core`

Create package in `packages/core`.

#### Build Configuration

- Configure `tsdown` for build
- Set up `package.json` scripts: `tsdown` and `tsdown --watch`
- Configure exports:
  - `dist/index.mjs` (ESM)
  - `dist/index.js` (CJS)
  - `dist/index.d.ts` (Types)

#### Dependencies

- `mongodb` - Native MongoDB Driver
- `cron-parser` - Cron expression parsing

#### Architecture

- Main class `Monque` extends `EventEmitter`
- Uses native MongoDB Driver (`Collection`, `Db`)

#### Implementation Details

1. **Enqueue Method**
   - Signature: `enqueue<T>(name, data, options)`
   - Support `uniqueKey` option using `updateOne` + `upsert`

2. **Schedule Method**
   - Signature: `schedule(cronExpression, name, data)`
   - Parse cron with `cron-parser`

3. **Worker Method**
   - Signature: `worker(name, handler)`
   - Register job processors

4. **Locking Engine**
   - Use `findOneAndUpdate` for atomic locking
   - Query: `status: 'pending'`, `nextRunAt <= NOW`
   - Update: `status: 'processing'`, `lockedAt: NOW`

5. **Exponential Backoff**
   - Formula: `nextRunAt = now + (2^failCount * 1 minute)`
   - Do not retry immediately on failure

6. **Graceful Shutdown**
   - `stop()` method stops polling loop
   - Wait for processing jobs (with configurable timeout)

7. **Event Emission**
   - `job:start`
   - `job:complete`
   - `job:fail`
   - `job:error`

#### Type Definitions

```typescript
export const JobStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
} as const;

export type JobStatus = typeof JobStatus[keyof typeof JobStatus];

export interface IJob<T = any> {
  _id?: ObjectId;
  name: string;
  data: T;
  status: JobStatus;
  nextRunAt: Date;
  lockedAt?: Date | null;
  failCount: number;
  failReason?: string;
  repeatInterval?: string;
  uniqueKey?: string;
}
```

---

### Phase 3: Package B - `@monque/tsed`

Create package in `packages/tsed`.

#### Build Configuration

- Configure `tsdown` for ESM/CJS/DTS
- Set up workspace dependency on `monque`

#### Dependencies

- `monque` (workspace)
- `@tsed/common`
- `@tsed/di`

#### Peer Dependencies

- `mongodb`
- `mongoose` (optional)

#### Implementation Details

1. **MonqueModule**
   - Accept connection token via DI
   - Hybrid connection detection:
     - Mongoose Connection → extract native `.db` handle
     - Native Db → use directly
   - Pass native Db to `Monque` core class

2. **Job Decorator**
   - Signature: `@Job({ name: string, ... })`
   - Register decorated class as worker

3. **DI Integration**
   - Use `injector.get(JobClass)` when worker runs
   - Provide full access to Ts.ED DI container

---

## Testing Strategy

### Test Categories

1. **Standard Operations**
   - Job queuing
   - Job locking
   - Job completion

2. **UniqueKey Constraints**
   - Duplicate prevention
   - Upsert behavior

3. **Failure Handling**
   - Worker failure
   - Exponential backoff calculation
   - Fail count tracking

4. **Graceful Shutdown**
   - Polling loop termination
   - In-progress job completion
   - Timeout behavior

5. **Error Simulation**
   - MongoDB connection failures
   - Driver errors (using `vi.spyOn` mocks)

### Coverage Target

100% code coverage across all test categories.

---

## Output Deliverables

1. File structure tree
2. `package.json` files (root and both packages) with:
   - `exports` configuration
   - `scripts` using `tsdown`
3. Full implementation of `Monque.ts` (Core)
4. Full implementation of `MonqueModule.ts` (Ts.ED)
5. Comprehensive Vitest test suite
