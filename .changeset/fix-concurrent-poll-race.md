---
"@monque/core": patch
---

- Fix race condition where concurrent poll cycles could exceed workerConcurrency limit. Added a guard to prevent overlapping poll() execution from setInterval and change stream triggers.
