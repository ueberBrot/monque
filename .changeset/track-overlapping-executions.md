---
'@monque/core': patch
---

Track overlapping executions of a recovered job separately. If the same scheduler claims the job again before its old handler finishes, worker concurrency, active counts, heartbeats, and graceful shutdown continue to account for both handlers.
