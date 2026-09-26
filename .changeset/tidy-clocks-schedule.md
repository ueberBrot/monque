---
'@monque/core': minor
---

Support an optional IANA `timezone` on recurring schedules, persisted with the job and
used for initial and subsequent cron occurrences. Omitted timezones preserve server-local
behavior. Upgrade all workers sharing a collection before enabling timezone schedules.
