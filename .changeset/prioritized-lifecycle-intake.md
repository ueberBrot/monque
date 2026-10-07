---
"@monque/core": minor
"@monque/tsed": minor
---

Accept per-Job priorities in batches and recurring schedules, including caller-owned transactions. Keep priority through retries, rescheduling, recovery, and subsequent recurring runs; duplicate active Jobs retain their original priority, payload, and schedule.

Forward priority through Ts.ED creation APIs and Cron decorators, and add optional priority and session options to MonqueService.now().

Require @monque/core 1.18.0 or newer for the Ts.ED priority options and their public types.
