# ADR-0002: Change Streams With Polling Safety Net

## Status

Accepted

## Context

Polling alone adds latency. MongoDB change streams can wake workers quickly, but they are
not available in every MongoDB deployment and can disconnect.

## Decision

Use change streams as the primary notification path when available. Keep polling as both
fallback and safety net.

When change streams are active, polling uses `safetyPollInterval`. When unavailable or
disconnected, polling uses `pollInterval`.

Local pending notifications are still emitted after local writes so scheduler latency does
not depend on change stream cursor timing.

## Consequences

Correctness cannot depend on change streams.

Wakeup routing must handle inserted jobs, jobs becoming pending, future `nextRunAt` values,
and slots freed by terminal transitions.
