---
'@monque/core': patch
---

Validate job names and unique keys at the public API boundary so invalid identifiers fail fast before reaching MongoDB operations.