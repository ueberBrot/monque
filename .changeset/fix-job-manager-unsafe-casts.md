---
"@monque/core": patch
---

Replace unsafe `as unknown as WithId<Job>` type casts in `job-manager` with bracket notation, consistent with the existing pattern in `retryJob`.
