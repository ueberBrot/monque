---
"@monque/core": patch
---

Use atomic `findOneAndUpdate` with status preconditions in `completeJob` and `failJob` to prevent phantom events when the DB write is a no-op. Events are now only emitted when the transition actually occurred, and `willRetry` is derived from the actual DB document state.
