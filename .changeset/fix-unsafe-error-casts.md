---
"@monque/core": patch
---

Replace 7 unsafe `error as Error` casts with a new `toError()` utility that safely normalizes unknown caught values into proper `Error` instances, preventing silent type lies when non-Error values are thrown.
