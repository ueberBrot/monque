---
'@monque/core': patch
---

Prevent a throwing `job:start` listener from permanently reducing worker capacity
and stalling subsequent jobs.
