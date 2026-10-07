---
"@monque/core": minor
---

Add signed `priority` values to `enqueue()` and `now()`; higher values run first among due Jobs with the same Job Name, with `0` as the default. Follow the [upgrade requirements](https://ueberbrot.github.io/monque/advanced/production-checklist/#10-ensure-index-permissions) for shared collections and indexes.
