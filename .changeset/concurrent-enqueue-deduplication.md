---
'@monque/core': patch
---

Return the existing active job when concurrent `enqueue()` or `schedule()` calls collide on the job-name and unique-key index. Unrelated database errors and collisions without an active matching job still reject.
