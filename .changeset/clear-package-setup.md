---
"@monque/core": patch
"@monque/management": patch
"@monque/management-express": patch
---

Correct package setup examples to use `workerConcurrency`, install the MongoDB peer
dependency, and initialize the scheduler before exposing Management queries and actions.
The repository overview now explains how the scheduler, adapters, and dashboard fit together.
