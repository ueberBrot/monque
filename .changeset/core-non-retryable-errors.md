---
'@monque/core': minor
---

Throw `NonRetryableError` from a worker to mark a job failed immediately without automatic
retries. Recurring jobs stop too. Failure events report `willRetry: false`, while manual
retry remains available after fixing the cause. Ordinary errors keep their existing retry policy.
