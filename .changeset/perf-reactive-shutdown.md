---
"@monque/core": patch
---

Replace the `setInterval(100)` busy-loop in `stop()` with a reactive drain promise that resolves instantly when all active jobs finish.
