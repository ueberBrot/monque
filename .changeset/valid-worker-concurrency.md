---
'@monque/core': patch
---

Reject non-finite, negative, and fractional worker concurrency during registration, before changing an existing worker. Zero concurrency remains supported.
