---
"@monque/docs": patch
---

Clarify permanent failures with `NonRetryableError`, manual retry, and recurring schedules.
Correct the retry timeline to show that the default failure limit permits nine retries
after the initial attempt, and explain the random jitter applied to retry delays.
