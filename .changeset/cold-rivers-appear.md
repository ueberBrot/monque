---
'@monque/core': patch
---

Prevent change stream reconnection attempts from running after the scheduler stops. This clears pending reconnect timers during shutdown and adds coverage for the stop-during-backoff scenario.
