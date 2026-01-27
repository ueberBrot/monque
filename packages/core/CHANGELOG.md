# @monque/core

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
