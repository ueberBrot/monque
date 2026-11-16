---
"@monque/core": minor
---

Accept a typed setup callback in `MonqueEffect.layer(db, options, setup)` to register Workers and start processing within one scoped Layer. Setup retains application service requirements and typed failures; failed setup disposes the scheduler.
