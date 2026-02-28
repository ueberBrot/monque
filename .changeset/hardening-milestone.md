---
'@monque/core': minor
---

Add payload size validation, instance collision detection, bulk job operations, and stats caching.

- feat: BSON payload size validation with configurable `maxPayloadSize` and `PayloadTooLargeError`
- feat: instance collision detection — prevents duplicate `schedulerInstanceId` conflicts with `ConnectionError`
- feat: bulk `cancelJobs()`/`retryJobs()` via `updateMany` for O(1) DB round-trips
- feat: TTL+LRU cache for `getQueueStats()` with configurable `statsCacheTtlMs`
- refactor: extract `LifecycleManager` service for timer/interval management and `cleanupJobs`
- refactor: deduplicate facade JSDoc via `@inheritdoc` references (~40% line reduction in `Monque` class)
