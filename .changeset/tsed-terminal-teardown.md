---
"@monque/tsed": minor
---

Release Monque-owned resources during application teardown by calling `dispose()`, including when job processing is disabled. The application still owns its MongoDB connection.
