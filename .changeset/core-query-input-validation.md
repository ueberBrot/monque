---
'@monque/core': patch
---

Reject MongoDB operators, invalid statuses, and invalid date bounds in job filters
with `InvalidJobQueryError`, preventing unintended reads and bulk actions. Invalid
single-job IDs return `null`.
