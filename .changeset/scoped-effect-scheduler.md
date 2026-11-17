---
"@monque/core": minor
---

Add `MonqueEffect.layer` and `Monque.scoped` for scoped initialization, native operations and terminal cleanup with a borrowed MongoDB connection. Disposal uses the caller's Effect clock and completes after interrupted admission. See the Effect guide for lifecycle and interruption behavior.
