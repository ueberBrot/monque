---
"@monque/core": minor
---

Add `Monque.dispose()` for final cleanup, including producer-only instances and concurrent shutdown calls. Disposal keeps the application's MongoDB connection open and waits for owned work; use `stop()` when processing needs to restart.
