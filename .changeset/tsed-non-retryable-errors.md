---
'@monque/tsed': minor
---

Stop automatic retries by throwing `NonRetryableError` from `@Job` or `@Cron` handlers.
Import the error from `@monque/core` 1.14.0 or later in your application. Failed jobs remain
available for inspection and manual retry through `MonqueService`, Management, and Dashboard.
