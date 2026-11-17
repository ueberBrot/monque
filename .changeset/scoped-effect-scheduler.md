---
"@monque/core": minor
---

Add `MonqueEffect.layer` and `Monque.scoped` for scoped initialization, native scheduler operations and terminal cleanup with a borrowed MongoDB connection. Disposal preserves the caller’s Effect clock and completes safely after interrupted admission; see the Effect integration guide for lifecycle and interruption behavior.
