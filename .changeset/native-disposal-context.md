---
"@monque/core": patch
---

Preserve the caller's Effect context during native disposal so its shutdown grace period honors custom clocks, including TestClock.
