---
"@monque/tsed": patch
---

Add producer-only mode support for Ts.ED instances.

- Added `disableJobProcessing` option to run Ts.ED instances in producer-only mode. When enabled, the instance can enqueue jobs and manage schedules but will not process any jobs, enabling a producer-consumer architecture.
