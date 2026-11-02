---
"@monque/core": patch
---

Fence new Job execution before capturing the shutdown drain, releasing late Claims instead of starting Workers outside the snapshot. Preserve a restarted run's notifications and change stream while an earlier stop finishes.
