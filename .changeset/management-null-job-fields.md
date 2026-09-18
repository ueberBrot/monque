---
"@monque/management": patch
---

Fix job responses when MongoDB stores an absent heartbeat interval, recurring schedule or unique key as `null`. These optional fields are now omitted from responses, allowing affected jobs to load correctly in API clients and the dashboard.
