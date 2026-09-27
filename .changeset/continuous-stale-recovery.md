---
'@monque/core': minor
---

Schedulers with `leaseDuration` enabled periodically recover abandoned jobs without requiring a restart. Recovery runs after each heartbeat and can be disabled with `recoverStaleJobs: false`.
