---
"@monque/core": minor
---

Accept a typed setup callback in `MonqueEffect.layer(db, options, setup)` to register Workers and start processing within one scoped Layer. Setup retains application services and resources through scheduler disposal and Worker finalizers; failed setup disposes the scheduler.
