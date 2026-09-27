---
"@monque/core": minor
---

Add optional `jobRetention.cancelled` to automatically delete cancelled jobs after a
configured age. Cleanup uses the cancellation timestamp and the existing retention
interval. Cancelled jobs remain indefinitely when the option is omitted.
