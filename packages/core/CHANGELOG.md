# @monque/core

## 1.7.2

### Patch Changes

- [#329](https://github.com/ueberBrot/monque/pull/329) [`0f8ff15`](https://github.com/ueberBrot/monque/commit/0f8ff15ce1b22f1a56d935ce3398863ed45e63f8) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add jitter to exponential backoff to prevent thundering-herd retries

- [#330](https://github.com/ueberBrot/monque/pull/330) [`1cbb22b`](https://github.com/ueberBrot/monque/commit/1cbb22b10885b6d886d6c4c00c03361356784720) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add `name` prefix to atomic claim compound index for per-worker scan efficiency

## 1.7.1

### Patch Changes

- [#300](https://github.com/ueberBrot/monque/pull/300) [`2e309e8`](https://github.com/ueberBrot/monque/commit/2e309e8ad99143d6c2ba36e139848ff98d83571b) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/core: mongodb (^7.1.0 → ^7.1.1)
  - @monque/tsed: mongodb (^7.1.0 → ^7.1.1)

## 1.7.0

### Minor Changes

- [#249](https://github.com/ueberBrot/monque/pull/249) [`2c7c079`](https://github.com/ueberBrot/monque/commit/2c7c0790d96b95efef4db2afb96204999d11cded) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add deprecation console warning for `defaultConcurrency` and `maxConcurrency` options.

- [#260](https://github.com/ueberBrot/monque/pull/260) [`c11798b`](https://github.com/ueberBrot/monque/commit/c11798be15ffb9f78abdc4432a954db4a17a05cc) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Parallelized job acquisition in the poll loop using `Promise.allSettled` to lower wall-clock acquisition latency / reduce serialized DB waits (fans out one `findOneAndUpdate` per free slot).

### Patch Changes

- [#269](https://github.com/ueberBrot/monque/pull/269) [`cb707b9`](https://github.com/ueberBrot/monque/commit/cb707b904406ad92a3bbf833c570a92868e7f3d9) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Validate job names and unique keys at the public API boundary so invalid identifiers fail fast before reaching MongoDB operations.

- [#266](https://github.com/ueberBrot/monque/pull/266) [`9c75d1c`](https://github.com/ueberBrot/monque/commit/9c75d1cde5330c4495ed930e4fb20fb5ad86a03e) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Fix `.then()` to `.finally()` in `executePollAndScheduleNext` to ensure the next poll is always scheduled, even if `scheduleNextPoll` throws. This prevents silently swallowed rejections when the callback in `.then()` throws.

- [#258](https://github.com/ueberBrot/monque/pull/258) [`218d398`](https://github.com/ueberBrot/monque/commit/218d3983bfb8e6b55d1a185378a4489650d7ec32) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Replace `getActiveJobs()` array allocation with `getActiveJobCount()` in shutdown path. The previous implementation created a throw-away `string[]` on every call just to check `.length`. The new method returns a count directly using `Map.size`, avoiding unnecessary array allocations during shutdown polling.

- [#259](https://github.com/ueberBrot/monque/pull/259) [`b0babc4`](https://github.com/ueberBrot/monque/commit/b0babc4c7a87020b39d0622ada388a4adf7d815c) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Replace the O(workers) iteration in `getTotalActiveJobs()` with an O(1) counter that updates on job acquisition and completion.

- [#263](https://github.com/ueberBrot/monque/pull/263) [`a30186f`](https://github.com/ueberBrot/monque/commit/a30186f24859bcdd9776fede95c848d1bdac3b32) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add compound index for job retention to avoid collection scan during cleanup

- [#264](https://github.com/ueberBrot/monque/pull/264) [`c2b046e`](https://github.com/ueberBrot/monque/commit/c2b046e13ec08814a9a9cd81415b7815499116a1) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Deduplicate `new Date()` calls in update operations. Instead of creating multiple `new Date()` instances milliseconds apart within the same logical operation, methods like `cancelJob`, `retryJob`, and `completeJob` now capture a single `const now = new Date()` and reuse it for all timestamp fields, ensuring consistent timestamps.

- [#265](https://github.com/ueberBrot/monque/pull/265) [`79300c0`](https://github.com/ueberBrot/monque/commit/79300c0d725994f7c9b33e3cf6d6b6217dec26d2) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Optimize `cancelJob`, `retryJob`, and `rescheduleJob` by removing redundant `findOne` pre-checks. These operations now use an optimistic `findOneAndUpdate` first, reducing database round-trips for the common happy paths.

- [#262](https://github.com/ueberBrot/monque/pull/262) [`1b6e29f`](https://github.com/ueberBrot/monque/commit/1b6e29fdcde765beeacf26785253b5cf8c96a145) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Removed redundant `$unset` operations for `heartbeatInterval` on job completion/failure to improve performance and retain observability metadata.

- [#257](https://github.com/ueberBrot/monque/pull/257) [`d71049d`](https://github.com/ueberBrot/monque/commit/d71049da3054de02f3cdd2ad27c021c82f463060) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Replace the `setInterval(100)` busy-loop in `stop()` with a reactive drain promise that resolves instantly when all active jobs finish.

- [#267](https://github.com/ueberBrot/monque/pull/267) [`965f8aa`](https://github.com/ueberBrot/monque/commit/965f8aa90742b9ea8e19685898216c6ad3af5011) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Set maxListeners to 20 on Monque EventEmitter to prevent memory leaks in long-running processes.

## 1.6.0

### Minor Changes

- [#232](https://github.com/ueberBrot/monque/pull/232) [`c3d2c83`](https://github.com/ueberBrot/monque/commit/c3d2c83b89d3fc8e77ec1958695d05b68f357d8d) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add adaptive poll scheduling and targeted change stream processing

  - **Adaptive polling**: When change streams are active, safety polling runs at `safetyPollInterval` (default 30s) instead of the fast `pollInterval`. Falls back to `pollInterval` when change streams are unavailable.
  - **Targeted polling**: Change stream events now leverage the full document to poll only the specific worker(s) for the affected job type, skipping unrelated workers.
  - **Wakeup timers**: Future-dated jobs (`nextRunAt > now`) get a precise wakeup timer instead of waiting for the next poll cycle.
  - **Local pending-job notifications**: Jobs created or moved back to `pending` by the local scheduler now trigger the same targeted polling and wakeup-timer path immediately, avoiding startup races before the change stream cursor is fully ready.
  - **Slot-freed re-polling**: When a job completes or permanently fails, a targeted re-poll immediately picks up the next waiting job for that worker.
  - **Re-poll queuing**: Poll requests arriving while a poll is running are queued and executed after, preventing silently dropped change-stream-triggered polls.
  - New configuration option: `safetyPollInterval` (default: 30000ms).

## 1.5.2

### Patch Changes

- [#227](https://github.com/ueberBrot/monque/pull/227) [`e9208ca`](https://github.com/ueberBrot/monque/commit/e9208ca5c985d84d023161560d5d3ba195394fe1) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Prevent change stream reconnection attempts from running after the scheduler stops. This clears pending reconnect timers during shutdown and adds coverage for the stop-during-backoff scenario.

## 1.5.1

### Patch Changes

- [#211](https://github.com/ueberBrot/monque/pull/211) [`7181215`](https://github.com/ueberBrot/monque/commit/7181215abac2b5cd231c63f10bf718f0314cc09f) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Close shutdown race condition window by stopping timers before setting isRunning flag

## 1.5.0

### Minor Changes

- [#196](https://github.com/ueberBrot/monque/pull/196) [`6a37fc4`](https://github.com/ueberBrot/monque/commit/6a37fc49be87006bc3bd7aa76bf7ba49978b43b5) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add payload size validation, instance collision detection, bulk job operations, and stats caching.

  - feat: BSON payload size validation with configurable `maxPayloadSize` and `PayloadTooLargeError`
  - feat: instance collision detection — prevents duplicate `schedulerInstanceId` conflicts with `ConnectionError`
  - feat: bulk `cancelJobs()`/`retryJobs()` via `updateMany` for O(1) DB round-trips
  - feat: TTL+LRU cache for `getQueueStats()` with configurable `statsCacheTtlMs`
  - refactor: extract `LifecycleManager` service for timer/interval management and `cleanupJobs`
  - refactor: deduplicate facade JSDoc via `@inheritdoc` references (~40% line reduction in `Monque` class)

## 1.4.0

### Minor Changes

- [#188](https://github.com/ueberBrot/monque/pull/188) [`9ce0ade`](https://github.com/ueberBrot/monque/commit/9ce0adebda2d47841a4420e94a440b62d10396a0) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Optimize MongoDB index creation by batching 7 sequential `createIndex()` calls into a single `createIndexes()` call. This reduces index creation from 7 round-trips to 1, significantly speeding up `initialize()` on first run.

  Also adds `skipIndexCreation` option to `MonqueOptions` for production deployments where indexes are managed externally (e.g., via migrations or DBA tooling).

### Patch Changes

- [#187](https://github.com/ueberBrot/monque/pull/187) [`67c9d9a`](https://github.com/ueberBrot/monque/commit/67c9d9a2a5df6c493d5f51c15a33cd38db49cbe0) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Use atomic `findOneAndUpdate` with status preconditions in `completeJob` and `failJob` to prevent phantom events when the DB write is a no-op. Events are now only emitted when the transition actually occurred, and `willRetry` is derived from the actual DB document state.

- [#173](https://github.com/ueberBrot/monque/pull/173) [`df0630a`](https://github.com/ueberBrot/monque/commit/df0630a5e5c84e3216f5b65a999ce618502f89ab) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Replace unsafe `as unknown as WithId<Job>` type casts in `job-manager` with bracket notation, consistent with the existing pattern in `retryJob`.

- [#186](https://github.com/ueberBrot/monque/pull/186) [`5697370`](https://github.com/ueberBrot/monque/commit/5697370cf278302ffa6dcaaf0a4fb34ed9c3bc00) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Replace 7 unsafe `error as Error` casts with a new `toError()` utility that safely normalizes unknown caught values into proper `Error` instances, preventing silent type lies when non-Error values are thrown.

- [#189](https://github.com/ueberBrot/monque/pull/189) [`1e32439`](https://github.com/ueberBrot/monque/commit/1e324395caf25309dfb7c40bc35edac60b8d80ad) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Extract `documentToPersistedJob` mapper into a standalone function for testability and add round-trip unit tests to guard against silent field-dropping when new Job fields are added.

## 1.3.0

### Minor Changes

- [#158](https://github.com/ueberBrot/monque/pull/158) [`2f83396`](https://github.com/ueberBrot/monque/commit/2f833966d7798307deaa7a1e655e0623cfb42a3e) Thanks [@renovate](https://github.com/apps/renovate)! - mongodb (^7.0.0 → ^7.1.0)

### Patch Changes

- [#160](https://github.com/ueberBrot/monque/pull/160) [`b5fcaf8`](https://github.com/ueberBrot/monque/commit/b5fcaf8be2a49fb1ba97b8d3d9f28f00850f77a1) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Fix race condition where concurrent poll cycles could exceed workerConcurrency limit. Added a guard to prevent overlapping poll() execution from setInterval and change stream triggers.

## 1.2.0

### Minor Changes

- [#112](https://github.com/ueberBrot/monque/pull/112) [`9b7f44f`](https://github.com/ueberBrot/monque/commit/9b7f44f5c1f6b4aa4215e571189cc03cbaa49865) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add instance-level concurrency throttling and deprecated old naming conventions.

  - Added `instanceConcurrency` option (formerly `maxConcurrency`) to limit the total number of jobs processed concurrently across all workers on a single Monque instance.
  - Added `workerConcurrency` as a clearer alias for `defaultConcurrency`.
  - Deprecated `maxConcurrency` and `defaultConcurrency` in favor of the new explicit names. They will be removed in the next major version.

## 1.1.2

### Patch Changes

- [#92](https://github.com/ueberBrot/monque/pull/92) [`e90bdb1`](https://github.com/ueberBrot/monque/commit/e90bdb1ef848398d08346e5bf165d146a8d710b5) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Remove ts-reset global type leakage from published source to prevent dependency errors and unintended global type changes in consumer projects.

## 1.1.1

### Patch Changes

- [#90](https://github.com/ueberBrot/monque/pull/90) [`0364f4b`](https://github.com/ueberBrot/monque/commit/0364f4b9452bc6b81961fce896ebcaeecbaafa58) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Add missing LICENSE and optimize build configuration (source maps, quality gates) for better developer experience and reliability.

## 1.1.0

### Minor Changes

- [#75](https://github.com/ueberBrot/monque/pull/75) [`ebb3a23`](https://github.com/ueberBrot/monque/commit/ebb3a230ec1cd59f381cd22dca19d71b0e568829) Thanks [@ueberBrot](https://github.com/ueberBrot)! - **Management APIs**: Introduced a comprehensive suite of management APIs for monitoring and controlling job queues:

  - **Single Job Management**: `cancelJob`, `retryJob`, `rescheduleJob`, `deleteJob`
  - **Bulk Operations**: `cancelJobs`, `retryJobs`, `deleteJobs` with rich filtering
  - **Cursor Pagination**: `getJobsWithCursor` for stable, efficient iteration over large datasets
  - **Statistics**: `getQueueStats` for monitoring queue health and performance

  **Events**: New events for observability include `job:cancelled`, `job:retried`, and `job:deleted`.

## 1.0.0

### Major Changes

- [#72](https://github.com/ueberBrot/monque/pull/72) [`448bc3e`](https://github.com/ueberBrot/monque/commit/448bc3ee2fddc1e7f5911331fec19e8995ac44ff) Thanks [@ueberBrot](https://github.com/ueberBrot)! - v1.0.0 Stable Release

## 0.3.0

### Minor Changes

- [#67](https://github.com/ueberBrot/monque/pull/67) [`75fafcd`](https://github.com/ueberBrot/monque/commit/75fafcd474277de581d127bc6b60e73f04dff9dc) Thanks [@renovate](https://github.com/apps/renovate)! - chore(deps): update dependencies

  - @monque/core: cron-parser (^5.4.0 → ^5.5.0)

## 0.2.0

### Minor Changes

- [#7](https://github.com/ueberBrot/monque/pull/7) [`eab1ab7`](https://github.com/ueberBrot/monque/commit/eab1ab710db66f84ad5d7edb9f42864619a1276f) Thanks [@ochrstn](https://github.com/ochrstn)! - API Rename: `worker()` → `register()`

  The public method for registering job handlers has been renamed from `worker()` to `register()` for improved API clarity.

  **Before:**

  ```typescript
  monque.worker("send-email", async (job) => {
    await sendEmail(job.data);
  });
  ```

  **After:**

  ```typescript
  monque.register("send-email", async (job) => {
    await sendEmail(job.data);
  });
  ```

  This is a **breaking change** for users upgrading from earlier versions. Update all `monque.worker()` calls to `monque.register()`.

- [#29](https://github.com/ueberBrot/monque/pull/29) [`5ac7759`](https://github.com/ueberBrot/monque/commit/5ac775965f9f2ab27211b02d7b048613e48705b2) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Upgrade Node.js Engine to >=22.0.0

  This release updates the `engines.node` requirement in `package.json` to `>=22.0.0`.

  **Breaking Change:** Users on Node.js versions older than 22.0.0 will no longer be able to install or use this package. Please upgrade to Node.js 22 (LTS) or later.

### Patch Changes

- [#48](https://github.com/ueberBrot/monque/pull/48) [`f37b90d`](https://github.com/ueberBrot/monque/commit/f37b90d51ab2773c405c34d423ce1810bbe50273) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Fix race condition in `poll()` where jobs could be processed after shutdown was initiated.

## 0.1.0

### Minor Changes

- [`fe193bb`](https://github.com/ueberBrot/monque/commit/fe193bb3d840667dded3c3ea093a464d3b1852ba) Thanks [@ueberBrot](https://github.com/ueberBrot)! - Initial pre-release of Monque core.

  - MongoDB-backed scheduler with atomic claiming/locking to prevent duplicate processing across multiple instances.
  - Workers + concurrency controls for background job processing.
  - Enqueue immediate jobs and schedule recurring jobs via 5-field cron expressions.
  - Built-in retries with configurable exponential backoff.
  - Heartbeats, stale job detection, and recovery on startup.
  - Event-driven observability for job lifecycle events (with change streams support and polling as a safety net).
