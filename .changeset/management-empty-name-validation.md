---
'@monque/management': patch
---

Return HTTP 400 for empty Job Name filters in listings, statistics, Queue Views,
and bulk actions. Omit the name filter to include all Job Names.
