---
"@monque/core": patch
---

Prevent jobs scheduled more than approximately 25 days ahead from triggering immediate scheduler wakeups and timer overflow warnings. Distant jobs now retain their intended wakeup time without unnecessary polling.
