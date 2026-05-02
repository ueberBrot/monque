# ADR-0001: Job Ownership And Stale Recovery

## Status

Accepted

## Context

Monque can run multiple scheduler instances against one MongoDB collection. Only one
instance may process a job at a time, and crashed instances must not leave jobs stuck
forever.

## Decision

Jobs are claimed with atomic MongoDB updates from `pending` to `processing`. The claim
writes `claimedBy`, `lockedAt`, `lastHeartbeat`, and `heartbeatInterval`.

Owned-job completion and failure require `status: processing` and `claimedBy` matching
the current scheduler instance.

Stale recovery treats `lockedAt + lockTimeout` as the source of truth. `lastHeartbeat`
remains an observability and instance-collision signal, not stale-recovery authority.

## Consequences

Race conditions concentrate in job state transition code.

Long-running jobs must set a lock timeout large enough for expected processing time.
Heartbeats do not extend the stale-recovery deadline.
