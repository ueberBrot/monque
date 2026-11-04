---
"@monque/tsed": patch
---

Forward empty `@Cron` expressions to the scheduler for validation and propagate scheduling errors during initialization, instead of silently registering an unscheduled Worker.
