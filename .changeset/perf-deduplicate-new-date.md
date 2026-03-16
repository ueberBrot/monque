---
'@monque/core': patch
---

Deduplicate `new Date()` calls in update operations. Instead of creating multiple `new Date()` instances milliseconds apart within the same logical operation, methods like `cancelJob`, `retryJob`, and `completeJob` now capture a single `const now = new Date()` and reuse it for all timestamp fields, ensuring consistent timestamps.
