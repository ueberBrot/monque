---
"@monque/core": minor
---

**Management APIs**: Introduced a comprehensive suite of management APIs for monitoring and controlling job queues:

- **Single Job Management**: `cancelJob`, `retryJob`, `rescheduleJob`, `deleteJob`
- **Bulk Operations**: `cancelJobs`, `retryJobs`, `deleteJobs` with rich filtering
- **Cursor Pagination**: `getJobsWithCursor` for stable, efficient iteration over large datasets
- **Statistics**: `getQueueStats` for monitoring queue health and performance

**Events**: New events for observability include `job:cancelled`, `job:retried`, and `job:deleted`.
