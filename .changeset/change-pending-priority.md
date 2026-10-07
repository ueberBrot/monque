---
"@monque/core": minor
---

Add `setJobPriority(id, priority)` to promote or demote pending Jobs without changing their schedule. Changes persist across recurring runs and are rejected after a Job is claimed.
