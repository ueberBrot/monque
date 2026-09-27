---
'@monque/core': minor
---

Add `pause()`, `resume()`, and `isPaused()` for local execution control, optionally scoped to one job name. Running jobs and heartbeats continue while new work waits; resuming wakes polling without a restart. Other scheduler instances are unaffected.
