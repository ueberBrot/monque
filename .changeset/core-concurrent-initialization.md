---
"@monque/core": patch
---

Share concurrent scheduler initialization so started timers and change streams remain owned and are released during shutdown. Failed initialization can still be retried.
