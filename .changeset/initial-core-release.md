---
"@monque/core": minor
---

Initial pre-release of Monque core.

- MongoDB-backed scheduler with atomic claiming/locking to prevent duplicate processing across multiple instances.
- Workers + concurrency controls for background job processing.
- Enqueue immediate jobs and schedule recurring jobs via 5-field cron expressions.
- Built-in retries with configurable exponential backoff.
- Heartbeats, stale job detection, and recovery on startup.
- Event-driven observability for job lifecycle events (with change streams support and polling as a safety net).
