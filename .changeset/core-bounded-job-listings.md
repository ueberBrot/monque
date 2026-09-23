---
'@monque/core': patch
---

Require listing limits of 1–1,000 and non-negative safe integer offsets, rejecting
invalid values with `InvalidJobQueryError`. Defaults are unchanged; paginate instead
of requesting unlimited results or more than 1,000 jobs per page.
