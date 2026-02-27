---
"@monque/core": minor
---

Optimize MongoDB index creation by batching 7 sequential `createIndex()` calls into a single `createIndexes()` call. This reduces index creation from 7 round-trips to 1, significantly speeding up `initialize()` on first run.

Also adds `skipIndexCreation` option to `MonqueOptions` for production deployments where indexes are managed externally (e.g., via migrations or DBA tooling).
