---
'@monque/core': minor
---

Add `enqueueMany()` to submit jobs in a batch with per-job scheduling and deduplication. The result reports inserted and deduplicated counts. Job identifiers and configured payload limits are checked before writing; database failures preserve the driver's partial-result details in `ConnectionError.cause`.
