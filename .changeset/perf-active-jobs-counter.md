---
"@monque/core": patch
---

Replace the O(workers) iteration in `getTotalActiveJobs()` with an O(1) counter that updates on job acquisition and completion.
