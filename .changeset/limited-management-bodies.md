---
"@monque/management": patch
"@monque/management-express": minor
---

Reject Management and Express request bodies over 64 KiB before job access, with a configurable `maxBodySize` limit.
