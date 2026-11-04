---
"@monque/core": patch
---

Reject empty or whitespace-only cron expressions consistently in validation helpers and scheduling, instead of allowing empty schedules to run once and stop recurring.
