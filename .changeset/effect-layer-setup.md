---
"@monque/core": minor
---

Add typed Worker setup to `MonqueEffect.layer(db, options, setup)`. Setup services and resources survive through scheduler disposal and Worker finalizers. Failed setup disposes the scheduler.
