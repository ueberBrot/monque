---
"@monque/core": minor
"@monque/tsed": minor
---

Set a priority for each Job in `enqueueMany()` or for a recurring `schedule()`, including when submitting Jobs in your own MongoDB transaction. Retries, rescheduling, recovery, and later recurring runs keep the Job's priority. Duplicate submissions with an active unique key keep its original priority, payload, and schedule.

Use the same priority options through Ts.ED's `MonqueService` and `@Cron`. `MonqueService.now()` also accepts optional `priority` and `session` values.

Ts.ED now requires `@monque/core` 1.18.0 or newer within version 1.
