---
"@monque/tsed": minor
---

Release Monque-owned resources during application teardown by calling `dispose()`, including when job processing is disabled. Requires `@monque/core` 1.21.0 or later for terminal disposal. The application still owns its MongoDB connection.
