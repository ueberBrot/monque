---
"@monque/management": minor
---

- Add `view=summary` to job listings to skip payload serialization and return `payload: null`. Full payloads remain the default.
- Add `POST /api/v1/jobs/actions/selected` to cancel, retry, reschedule, or delete up to 100 selected job IDs, with per-job authorization and individual failure details. Authorization callbacks receive the selected `ids`.
- Add `parallelCapabilityChecks` to run independent authorization checks concurrently; sequential checks remain the default.
- Fix job responses when optional heartbeat intervals, recurring schedules, or unique keys are stored as `null` in MongoDB. These fields are omitted from responses so affected jobs load correctly.
