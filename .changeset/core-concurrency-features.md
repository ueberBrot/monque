---
"@monque/core": minor
---

Add instance-level concurrency throttling and deprecated old naming conventions.

- Added `instanceConcurrency` option (formerly `maxConcurrency`) to limit the total number of jobs processed concurrently across all workers on a single Monque instance.
- Added `workerConcurrency` as a clearer alias for `defaultConcurrency`.
- Deprecated `maxConcurrency` and `defaultConcurrency` in favor of the new explicit names. They will be removed in the next major version.
