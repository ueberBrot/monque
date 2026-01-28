---
"@monque/core": minor
"@monque/tsed": minor
---

Add instance-level concurrency throttling and producer-only mode

- **@monque/core**:
  - Added `instanceConcurrency` option (formerly `maxConcurrency`) to limit the total number of jobs processed concurrently across all workers on a single Monque instance.
  - Added `workerConcurrency` as a clearer alias for `defaultConcurrency`.
  - Deprecated `maxConcurrency` and `defaultConcurrency` in favor of the new explicit names. They will be removed in the next major version.
- **@monque/tsed**:
  - Added `disableJobProcessing` option to run Ts.ED instances in producer-only mode. When enabled, the instance can enqueue jobs and manage schedules but will not process any jobs, enabling a producer-consumer architecture.
