---
'@monque/core': patch
---

Reject invalid numeric scheduler options at construction. Timer intervals outside the supported range now fail clearly instead of causing rapid polling. Existing zero limits, fractional durations, disabled statistics caching, and immediate retention remain supported.
