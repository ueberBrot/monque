---
'@monque/core': minor
---

Override `maxRetries`, `baseRetryInterval`, and `maxBackoffDelay` when registering a worker. Omitted values inherit scheduler defaults. Active executions retain their retry policy when their worker is replaced.
