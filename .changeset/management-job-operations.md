---
"@monque/management": minor
---

- Add `view=summary` to job listings to skip payload serialization and return `payload: null`. Full payloads remain the default.
- Add `POST /api/v1/jobs/actions/selected` to cancel, retry, reschedule, or delete up to 100 selected job IDs, with per-job authorization and individual failure details. Authorization callbacks receive the selected `ids`. Selected actions keep progressing when individual jobs are slow.
- Add an optional exact `name` filter to `GET /api/v1/queue-views` to retrieve summaries for a single Queue View. Requests without a filter continue to return all Queue Views.
- Add `parallelCapabilityChecks` to run independent authorization checks concurrently; sequential checks remain the default.
- Fix job responses when optional heartbeat intervals, recurring schedules, or unique keys are stored as `null` in MongoDB. These fields are omitted from responses so affected jobs load correctly.
- Require `@monque/core` 1.12.0 or newer within version 1 so job details and actions can look up jobs by string ID. Upgrade core alongside Management.
