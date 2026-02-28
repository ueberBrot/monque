# @monque/core

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
