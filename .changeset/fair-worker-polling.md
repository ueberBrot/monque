---
'@monque/core': patch
---

Prevent a busy worker from starving later-registered workers when `instanceConcurrency` limits shared capacity. Polling resumes after the last worker served, including when a notification targets only the busy worker.
