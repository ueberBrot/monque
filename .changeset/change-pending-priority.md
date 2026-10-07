---
"@monque/core": minor
"@monque/management": minor
"@monque/dashboard": minor
"@monque/management-express": minor
"@monque/dashboard-express": minor
---

Promote or demote pending Jobs with `setJobPriority(id, priority)`, through the Management API, or with **Change priority** in the Dashboard. In the Dashboard, review the value before confirming. The change keeps the scheduled time and applies to later recurring runs. If another scheduler has already claimed the Job, the change is rejected.

Control access with the `setJobPriority` authorization action. Read-only mode and schedulers without this method disable the action.

The Management Express adapter accepts Management 0.8.x and 0.9.x; use 0.9.x with core 1.18.0 or newer for priority changes. The Dashboard Express adapter includes the updated Dashboard.
