---
"@monque/core": patch
---

Fix `.then()` to `.finally()` in `executePollAndScheduleNext` to ensure the next poll is always scheduled, even if `scheduleNextPoll` throws. This prevents silently swallowed rejections when the callback in `.then()` throws.