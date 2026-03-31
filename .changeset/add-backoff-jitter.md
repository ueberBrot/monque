---
'@monque/core': patch
---

Add jitter to exponential backoff to prevent thundering-herd retries

Per-job automatic retries now apply random jitter (±25% by default) to backoff delays.
Previously, all jobs failing with the same `failCount` would schedule their retry at the
exact same `nextRunAt` timestamp, causing coordinated retry storms under load.

New exports:
- `applyJitter(delay, factor)` — apply random jitter to a delay value
- `DEFAULT_JITTER_FACTOR` — the default jitter factor (0.25)

The `calculateBackoff()` and `calculateBackoffDelay()` functions now accept an optional
`jitterFactor` parameter (default: `0.25`). Pass `0` to disable jitter for deterministic
behavior.
