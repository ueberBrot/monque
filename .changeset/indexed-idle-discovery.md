---
"@monque/core": patch
---

Reduce idle polling to one indexed read across eligible job names, avoiding atomic claim attempts for empty workers.
