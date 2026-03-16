---
'@monque/core': patch
---

Replace `getActiveJobs()` array allocation with `getActiveJobCount()` in shutdown path. The previous implementation created a throw-away `string[]` on every call just to check `.length`. The new method returns a count directly using `Map.size`, avoiding unnecessary array allocations during shutdown polling.
