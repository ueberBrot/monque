---
"@monque/core": patch
---

Avoid emitting `job:cancelled` for no-op cancellations.

- Keep `cancelJob()` idempotent for already-cancelled jobs.
- Emit `job:cancelled` only when a job transitions from `pending` to `cancelled`.
