---
"@monque/core": patch
---

Removed redundant `$unset` operations for `heartbeatInterval` on job completion/failure to improve performance and retain observability metadata.
