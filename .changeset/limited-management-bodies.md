---
"@monque/management": patch
"@monque/management-express": patch
---

Reject Management and Express request bodies over 64 KiB before job access, with a configurable `maxBodySize` limit.
