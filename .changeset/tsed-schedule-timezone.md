---
'@monque/tsed': minor
---

Use `timezone` with `@Cron` and `MonqueService.schedule()` to schedule recurring jobs in
an IANA timezone. Requires `@monque/core` 1.13.0 or later on every worker; upgrading Ts.ED
alone does not upgrade the application's core peer dependency.
