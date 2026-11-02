---
"@monque/core": patch
---

Preserve unrelated unique-index failures in `enqueueMany()` instead of counting them as deduplicated Jobs. Native error details, original operation indices and successful partial writes remain available.
