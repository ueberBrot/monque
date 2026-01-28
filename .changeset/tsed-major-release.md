---
"@monque/tsed": major
---

Rename `@Worker` and `@WorkerController` to `@Job` and `@JobController`.

This is a breaking change that aligns the terminology with the core package and general job queue conventions.

- Renamed `@Worker` decorator to `@Job`
- Renamed `@WorkerController` decorator to `@JobController`
- Renamed internal metadata types and store keys to use "Job" instead of "Worker" (e.g., `JobStore`, `JobMetadata`)
- Updated logging and constants to reflect the change
- Added `disableJobProcessing` option to run Ts.ED instances in producer-only mode. When enabled, the instance can enqueue jobs and manage schedules but will not process any jobs.
