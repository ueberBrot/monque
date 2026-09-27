---
'@monque/core': patch
---

Wake local workers when an execution finishes, so queued jobs can use freed capacity without waiting for the polling interval when MongoDB change streams are unavailable.
