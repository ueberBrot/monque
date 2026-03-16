---
"@monque/core": patch
---

Optimize `cancelJob`, `retryJob`, and `rescheduleJob` by removing redundant `findOne` pre-checks. These operations now use an optimistic `findOneAndUpdate` first, reducing database round-trips for the common happy paths.
