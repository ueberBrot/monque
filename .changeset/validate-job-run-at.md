---
"@monque/core": patch
---

Reject invalid `runAt` Dates before enqueueing or rescheduling Jobs. Batch enqueueing validates every scheduled time before writing, preventing malformed Dates from being stored as immediately due Jobs.
