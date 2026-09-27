---
"@monque/core": patch
---

Clear the shutdown deadline after running jobs finish so Node.js can exit promptly,
without waiting for the rest of `shutdownTimeout` (30 seconds by default).
