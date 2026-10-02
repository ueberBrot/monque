---
"@monque/core": patch
---

Keep restarted scheduler streams and heartbeat timers active when an earlier shutdown finishes. Each shutdown waits for the jobs that were already running when it began.
