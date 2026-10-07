---
"@monque/core": minor
"@monque/management": minor
"@monque/dashboard": minor
"@monque/management-express": minor
"@monque/dashboard-express": minor
---

Add `setJobPriority(id, priority)` to promote or demote pending Jobs without changing their schedule. Priority changes apply to future recurring runs and reject if another scheduler has already claimed the Job.

Add the Management priority action, authorization capability, and Dashboard confirmation control. Update the Express adapters for the compatible Management and Dashboard releases.
