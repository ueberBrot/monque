---
"@monque/core": minor
---

Parallelized job acquisition in the poll loop using `Promise.allSettled` to lower wall-clock acquisition latency / reduce serialized DB waits (fans out one `findOneAndUpdate` per free slot).
