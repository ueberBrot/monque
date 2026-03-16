---
"@monque/core": minor
---

perf: parallelized job acquisition in the poll loop using Promise.allSettled to reduce database round-trips.
