---
"@monque/core": patch
---

Reduce idle polling to one indexed read across eligible job names on collections with default binary collation, avoiding atomic claim attempts for empty workers.
