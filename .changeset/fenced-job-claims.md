---
'@monque/core': patch
---

Prevent late handlers and heartbeats from changing a recovered job's newer execution when a scheduler ID is reused. Each execution now has its own claim ID. Upgrade all schedulers sharing the collection to apply the protection consistently; handlers still need to tolerate duplicate side effects.
