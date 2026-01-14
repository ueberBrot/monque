---
"@monque/core": patch
---

Fix race condition in `poll()` where jobs could be processed after shutdown was initiated.
