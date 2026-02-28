# Phase 3: Performance Optimization - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Make cancelJobs()/retryJobs() use bulk MongoDB operations (updateMany) instead of per-document cursor iteration, reducing DB round-trips from O(n) to O(1). Add TTL-based caching to getQueueStats() with configurable `statsCacheTtlMs` option. Single-job operations (cancelJob, retryJob) remain unchanged.

</domain>

<decisions>
## Implementation Decisions

### Bulk operation error reporting
- Counts only — no per-job error detail. updateMany returns matched/modified counts
- Keep existing `BulkOperationResult` return type with `count` populated and `errors` array always empty
- Events (`jobs:cancelled`, `jobs:retried`) emit with count only, not individual job IDs
- Idempotency handled naturally: already-cancelled jobs don't match the status filter, modified count reflects actual changes

### Stats cache invalidation
- TTL-only invalidation — no proactive cache clearing after mutations (enqueue, bulk ops, etc.)
- Per-filter caching: separate cache entries for unfiltered stats and each distinct job name filter, each with own TTL timer
- LRU eviction with max size cap to prevent unbounded memory growth from many unique job names
- Clear entire cache on stop() — clean state if instance restarts

### Race condition handling
- Status filter embedded in updateMany query (e.g., `{ status: 'pending' }` for cancel, `{ status: { $in: ['failed', 'cancelled'] } }` for retry)
- Accept natural race behavior: if a job transitions between consumer's intent and MongoDB execution, it silently won't match — this is fine
- Uniform reset for all retried jobs: status=pending, failCount=0, unset lock fields
- Single-job operations (cancelJob, retryJob) stay as-is with findOneAndUpdate — only bulk methods change

### Bulk retry timing
- retryJobs() staggers nextRunAt across retried jobs to avoid thundering herd
- Implemented via MongoDB aggregation update expression (pipeline-style update in updateMany) with random spread
- Dynamic spread window: `min(jobCount * 100ms, 30000ms)` — scales with volume, capped at 30 seconds
- cancelJobs() does NOT stagger (cancelled jobs aren't re-queued)

### Cache configuration surface
- Single new option: `statsCacheTtlMs` in MonqueOptions
- Default: 5000ms (5 seconds), matching PERF-02 requirement
- Set to 0 to disable caching entirely (every call hits DB)
- No public cache invalidation method — cache is internal
- LRU max size is an internal default, not user-configurable

### Claude's Discretion
- LRU max size value (reasonable default like 50-100)
- Internal cache implementation (simple Map with timestamps vs dedicated structure)
- Exact aggregation pipeline expression for random stagger
- How to handle the two-step problem: retryJobs needs to know count for dynamic spread, but updateMany is one operation (may need a count query first, or use a fixed reasonable spread)

</decisions>

<specifics>
## Specific Ideas

- cancelJobs() should mirror deleteJobs() which already uses deleteMany — similar simplicity
- The stagger for retryJobs is a deliberate choice to avoid thundering herd when retrying large batches — the dynamic window ensures small retries (10 jobs) spread over ~1s while large retries (500 jobs) spread over 30s
- Event payload change (IDs → count) is a behavioral change — existing tests asserting per-job errors should be replaced, not adapted

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-performance-optimization*
*Context gathered: 2026-02-28*
