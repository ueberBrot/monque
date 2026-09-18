---
"@monque/management": patch
---

Only use explicitly defined per-job payload serializers. This prevents job names such as `constructor` from bypassing payload redaction and exposing raw job data or request context in management responses.
