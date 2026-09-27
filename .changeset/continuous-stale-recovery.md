---
'@monque/core': minor
---

Schedulers with `leaseDuration` enabled periodically recover abandoned jobs without requiring a restart. Recovery uses the existing heartbeat timer and respects `recoverStaleJobs: false`.
