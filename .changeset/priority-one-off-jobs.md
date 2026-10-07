---
"@monque/core": minor
"@monque/management": minor
"@monque/dashboard": minor
---

Set `priority` on `enqueue()` and `now()` to choose which due Job is claimed next. Higher values take precedence within the same Job Name; the default is `0`, and negative values put work below that default. Priorities must be signed safe integers. Jobs with equal priority are claimed by scheduled time, then identifier.

Inspect priorities in core reads and events, Management API responses and OpenAPI, and Dashboard job lists and details.

Upgrade every producer and scheduler sharing a collection for consistent ordering. Initialization sets missing priorities to `0` without changing existing priorities or lifecycle metadata, even when index creation is disabled. If you manage indexes yourself, add the priority claim index and keep the deadline index.
