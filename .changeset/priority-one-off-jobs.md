---
"@monque/core": minor
"@monque/management": minor
"@monque/dashboard": minor
---

Add signed safe-integer priorities to single Job intake and immediate `now()` options. Due Jobs with the same name are claimed by descending priority, then scheduled time and identifier; omitted priorities default to zero. Initialization automatically normalizes legacy Jobs without changing their lifecycle metadata, including with user-managed indexes. Upgrade all producers and claiming Scheduler Instances for uniform ordering.

Expose effective priority in core reads and events, Management DTOs and OpenAPI, and Dashboard Job tables and details. Keep deadline discovery and its indexes independent from the new priority claim index.
