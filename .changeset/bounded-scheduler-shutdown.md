---
"@monque/core": patch
---

Share the shutdown timeout between change-stream cleanup and active Job draining, so a pending MongoDB cursor close cannot indefinitely delay `stop()`.
