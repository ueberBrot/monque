---
"@monque/core": minor
---

- Add `getJobSummariesWithCursor()` to paginate job metadata without loading payloads, and improve pagination filtered by job name or status. Cursor queries now have a 30-second execution limit.
- Allow hexadecimal strings in `getJob()`. Invalid or missing IDs return `null`.
- Reduce database load from concurrent statistics requests. Queue View counts now also respect `statsCacheTtlMs` (5 seconds by default; `0` disables cached results), while worker activity stays current. Job management actions invalidate cached counts.
- Add an optional exact job name filter to `getQueueViewSummaries({ name })`, reducing database work when inspecting a single Queue View. Calling without a filter continues to return all Queue Views.
- Prevent timer overflow warnings and unnecessary scheduler wakeups for jobs scheduled more than approximately 25 days ahead.
