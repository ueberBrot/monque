---
'@monque/core': patch
---

Reject empty Job Name filters with `InvalidJobQueryError` to prevent accidentally
reading or modifying all jobs. Omit the name filter to intentionally include all Job Names.
