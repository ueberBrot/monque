# System Role & Context
You are an expert TypeScript Backend Architect and Library Maintainer. You specialize in MongoDB, Node.js event loops, the Ts.ED framework, and modern build tooling. You are strict about type safety, performance, and clean architecture.

# Task
Scaffold and implement a **Turbo Monorepo** project using **Bun** as the package manager. The project consists of two packages for a new job scheduler library called **"Monque"** (Mongo Queue).

# Tech Stack & Constraints
1.  **Monorepo:** Turborepo.
2.  **Package Manager:** Bun (Workspaces).
3.  **Bundler/Scaffolding:** `tsdown`. **Crucial:** Use `tsdown` to configure the build scripts and package structure. The `package.json` exports and build commands must rely on `tsdown` to handle ESM/CJS generation and type definitions.
4.  **Testing:** Vitest (with UI and Coverage enabled). **Strict Requirement:** The project must aim for **100% test coverage**. You must implement tests not just for "happy paths" but also for:
    *   Edge cases (e.g., duplicate unique keys).
    *   Error handling (e.g., database connection failures, worker errors).
    *   Race conditions (e.g., locking conflicts).
    *   Backoff logic verification.
5.  **Linting:** Biome (for fast linting/formatting).
6.  **Versioning:** Changesets (configured for GitHub Actions).
7.  **Language:** Strict TypeScript.

---

# Implementation Plan

## Phase 1: Project Structure & Tooling
Please set up the root files for a Turbo monorepo.
*   **Workspaces:** Configure `bun` workspaces for `./packages/*`.
*   **Linting:** Initialize **Biome** for the root.
*   **Release:** Initialize `changesets` and create a `.github/workflows/release.yml` that uses `changesets/action` to publish to NPM/GitHub Package Registry.

## Phase 2: Package A - `@monque/core` (The Scheduler)
Create a package named `monque` in `packages/core`.
*   **Setup:** Configure this package to be built with `tsdown`. Ensure `package.json` scripts are set to `tsdown` and `tsdown --watch`.
*   **Dependencies:** `mongodb` (Driver), `cron-parser`.
*   **Architecture:** The main class `Monque` must extend `EventEmitter`.
*   **Key Logic:**
    1.  **Native Driver:** It must use the native MongoDB Driver (`Collection`, `Db`).
    2.  **Enqueue:** Implement `enqueue<T>(name, data, options)` for one-off jobs. Support a `uniqueKey` option (using `updateOne` + `upsert`) to prevent duplicate jobs (crucial for data syncing scenarios).
    3.  **Schedule:** Implement `schedule(cronExpression, name, data)` for recurring jobs.
    4.  **Workers:** Implement `worker(name, handler)` to register job processors.
    5.  **Locking Engine:** It must use `findOneAndUpdate` to atomically lock jobs.
        *   *Query:* `status: 'pending'`, `nextRunAt <= NOW`.
        *   *Update:* `status: 'processing'`, `lockedAt: NOW`.
    6.  **Resilience (Exponential Backoff):** When a job fails, do not retry immediately. Implement a backoff strategy (e.g., `nextRunAt = now + (2^failCount * 1 minute)`).
    7.  **Graceful Shutdown:** Implement a `stop()` method. When called, it should stop the polling loop and wait for currently processing jobs to finish (up to a timeout).
    8.  **Observability:** Emit events for `job:start`, `job:complete`, `job:fail`, and `job:error`.
    9.  **Interfaces & Types:**
        *   Do **not** use TypeScript Enums. Use the **`as const`** pattern to ensure better tree-shaking and compatibility.
        ```typescript
        export const JobStatus = {
          PENDING: 'pending',
          PROCESSING: 'processing',
          COMPLETED: 'completed',
          FAILED: 'failed'
        } as const;
        export type JobStatus = typeof JobStatus[keyof typeof JobStatus];

        export interface IJob<T = any> {
            _id?: ObjectId; name: string; data: T; status: JobStatus;
            nextRunAt: Date; lockedAt?: Date | null;
            failCount: number; failReason?: string;
            repeatInterval?: string; uniqueKey?: string;
        }
        ```

## Phase 3: Package B - `@monque/tsed` (Framework Integration)
Create a package named `tsed-monque` in `packages/tsed`.
*   **Setup:** Configure this package to be built with `tsdown` (ESM/CJS/DTS).
*   **Dependencies:** `monque` (workspace), `@tsed/common`, `@tsed/di`.
*   **Peer Dependencies:** `mongodb`, `mongoose` (optional).
*   **Key Logic:**
    1.  **Module:** Create `MonqueModule`. It should accept a connection token via DI.
    2.  **Hybrid Support:** In the module constructor, check the injected object.
        *   If it is a **Mongoose Connection**, extract the native `.db` handle from it.
        *   If it is a **Native Db**, use it directly.
        *   Pass the native Db to the `Monque` core class.
    3.  **Decorators:** Implement a `@Job({ name: string, ... })` decorator that registers the class as a worker.
    4.  **Dependency Injection:** When the worker runs, it must use `injector.get(JobClass)` so that the job class has full access to the Ts.ED dependency injection container (services, repos, etc.).

---

# Output Requests
1.  Provide the file structure tree.
2.  Provide the `package.json` for the root and both packages. **Important:** Explicitly show the `exports` configuration (pointing to `dist/index.mjs`, `dist/index.js`, `dist/index.d.ts`) and the `scripts` using `tsdown`.
3.  Provide the full implementation code for `Monque.ts` (Core) and `MonqueModule.ts` (Ts.ED).
4.  Write a comprehensive **Vitest** test suite for the Core package.
    *   Include tests for standard queuing and locking.
    *   Include tests for **uniqueKey constraints** (preventing duplicates).
    *   Include tests for **worker failure and exponential backoff**.
    *   Include tests for **Graceful Shutdown** (ensuring loops stop).
    *   Demonstrate 100% coverage by simulating MongoDB errors (e.g., using `vi.spyOn` to mock driver failures).
