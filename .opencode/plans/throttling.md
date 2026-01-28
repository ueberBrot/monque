# Implementation Plan: Instance Throttling & Producer-only Mode

This plan outlines the changes required to implement global instance-level concurrency limits and a "Producer-only" mode for the Monque job scheduler, including code, JSDoc, documentation, and changeset updates.

## 1. Objective
- **Instance Throttling**: Limit the total number of jobs processed by a single instance across all workers.
- **Producer-only Mode**: Allow an instance to enqueue jobs without starting workers or polling loops (useful for API-only nodes).
- **Documentation**: Ensure all new features are fully documented in JSDoc and the official documentation site.
- **Release**: Create a changeset to document the minor version bump for affected packages.

---

## 2. Core Package Enhancements (`@monque/core`)

### 2.1 Update Configuration Types
**File:** `packages/core/src/scheduler/types.ts`
- Add `maxConcurrency?: number` to `MonqueOptions`.
- **JSDoc**: 
  ```typescript
  /**
   * Maximum number of concurrent jobs processed by this instance across all registered workers.
   * If reached, the scheduler will stop claiming new jobs until active jobs complete.
   * Use this to prevent a single instance from overwhelming system resources.
   */
  maxConcurrency?: number;
  ```

### 2.2 Implement Global Throttling
**File:** `packages/core/src/scheduler/services/job-processor.ts`
- **Method `getTotalActiveJobs()`**: Implement a private helper to sum the size of `activeJobs` maps from all workers in `ctx.workers`.
- **Method `poll()`**:
    - Add a guard at the start: `if (this.ctx.options.maxConcurrency && this.getTotalActiveJobs() >= this.ctx.options.maxConcurrency) return;`.
    - Update the inner acquisition loop to also check the global limit before each `acquireJob()` call.

---

## 3. Ts.ED Integration (`@monque/tsed`)

### 3.1 Update Configuration
**File:** `packages/tsed/src/config/types.ts`
- Add `disableJobProcessing?: boolean` to `MonqueTsedConfig`.
- **JSDoc**:
  ```typescript
  /**
   * Disable job processing on this instance.
   * 
   * When true, the module will initialize the database connection (allowing you to 
   * enqueue jobs via MonqueService) but will NOT register workers or start the 
   * polling loop. Useful for "Producer-only" nodes like APIs.
   * 
   * @default false
   */
  disableJobProcessing?: boolean;
  ```

### 3.2 Update Module Lifecycle
**File:** `packages/tsed/src/monque-module.ts`
- **Method `$onInit()`**:
    - Always call `await this.monque.initialize()`.
    - Wrap `await this.registerWorkers()` and `await this.monque.start()` in a conditional block: `if (!config.disableJobProcessing) { ... }`.
    - Log a message when processing is disabled: `Monque: Job processing is disabled for this instance`.

---

## 4. Documentation Updates (`apps/docs`)

### 4.1 Core Documentation
**File:** `apps/docs/src/content/docs/core-concepts/workers.mdx`
- Add "Instance-level Concurrency" section explaining `maxConcurrency` and its relation to per-worker concurrency.

### 4.2 Ts.ED Documentation
**File:** `apps/docs/src/content/docs/integrations/tsed.mdx`
- Add "Producer-only Mode" section explaining how to separate API and Worker nodes using `disableJobProcessing`.

### 4.3 Production Checklist
**File:** `apps/docs/src/content/docs/advanced/production-checklist.mdx`
- Add "Producer-Consumer Architecture" to the checklist.
- Update Section 6 "Set Appropriate Concurrency" to include `maxConcurrency`.

---

## 5. Verification Strategy

### 5.1 Unit Tests (Core)
- **File**: `packages/core/tests/unit/services/job-processor.test.ts`
- Test that `poll()` exits early when `maxConcurrency` is reached.
- Test that `poll()` partially fills available slots up to `maxConcurrency`.

### 5.2 Integration Tests (Ts.ED)
- **Producer-only Test**:
    - Bootstrap with `disableJobProcessing: true`.
    - Enqueue a job via `MonqueService`.
    - Verify `monque.isHealthy()` is false (since it's not "running").
    - Verify the job stays `pending` even if a worker is defined.
- **Global Concurrency Test**:
    - Bootstrap with `maxConcurrency: 2` and two workers.
    - Enqueue 5 jobs for each worker.
    - Verify that `db.collection.countDocuments({ status: 'processing' })` never exceeds 2.

---

## 6. Agent Implementation Checklist

- [ ] **Step 0: Preparation**
  - [ ] Create a new branch `feat/throttling-and-producer-mode`.
- [ ] **Step 1: Core Implementation**
  - [ ] Add `maxConcurrency` with JSDoc to `packages/core/src/scheduler/types.ts`.
  - [ ] Implement throttling logic in `packages/core/src/scheduler/services/job-processor.ts`.
- [ ] **Step 2: Ts.ED Implementation**
  - [ ] Add `disableJobProcessing` with JSDoc to `packages/tsed/src/config/types.ts`.
  - [ ] Apply conditional logic in `packages/tsed/src/monque-module.ts`.
- [ ] **Step 3: Documentation Site**
  - [ ] Update `apps/docs/src/content/docs/core-concepts/workers.mdx`.
  - [ ] Update `apps/docs/src/content/docs/integrations/tsed.mdx`.
  - [ ] Update `apps/docs/src/content/docs/advanced/production-checklist.mdx`.
- [ ] **Step 4: Verification**
  - [ ] Run `bun run test:unit` in `packages/core`.
  - [ ] Add and run new integration tests in `packages/tsed`.
  - [ ] Run `bun run check` in root.
- [ ] **Step 5: Release Preparation**
  - [ ] Run `bun changeset` and select `@monque/core` and `@monque/tsed` (minor bump).
