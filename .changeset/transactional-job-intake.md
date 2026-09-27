---
'@monque/core': minor
---

Accept caller-owned MongoDB sessions in `enqueue()`, `enqueueMany()`, and `schedule()`, so job writes can commit or roll back with application data. Workers see transactional jobs only after commit, and native transaction errors retain the labels used by MongoDB's retry handling.
