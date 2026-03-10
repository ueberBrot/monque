---
'@monque/core': minor
---

Add adaptive poll scheduling and targeted change stream processing

- **Adaptive polling**: When change streams are active, safety polling runs at `safetyPollInterval` (default 30s) instead of the fast `pollInterval`. Falls back to `pollInterval` when change streams are unavailable.
- **Targeted polling**: Change stream events now leverage the full document to poll only the specific worker(s) for the affected job type, skipping unrelated workers.
- **Wakeup timers**: Future-dated jobs (`nextRunAt > now`) get a precise wakeup timer instead of waiting for the next poll cycle.
- **Slot-freed re-polling**: When a job completes or permanently fails, a targeted re-poll immediately picks up the next waiting job for that worker.
- **Re-poll queuing**: Poll requests arriving while a poll is running are queued and executed after, preventing silently dropped change-stream-triggered polls.
- New configuration option: `safetyPollInterval` (default: 30000ms).
