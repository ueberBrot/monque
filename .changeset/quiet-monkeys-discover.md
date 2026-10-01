---
"@monque/core": patch
---

Reduce idle job discovery to one indexed read across eligible job names, discover persisted
future deadlines at startup, and retain targeted wakeups through overlapping notifications.
Filter processing-only change stream updates and omit job payloads from stream notifications
while preserving atomic claims, fair shared concurrency, and polling fallback.
