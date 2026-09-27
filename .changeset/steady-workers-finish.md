---
"@monque/core": patch
---

Preserve running jobs when replacing a worker with `register(..., { replace: true })`.
Existing jobs continue to count toward concurrency limits, appear in Queue Views, and
finish before graceful shutdown returns.
