---
"@monque/core": minor
---

Allow `getJob()` to accept a hexadecimal job ID string as well as a MongoDB `ObjectId`, so jobs can be retrieved directly using IDs from URLs, logs and Management API responses. Invalid ID strings and IDs that do not match a job return `null`.
