# ADR-0001: Job Ownership And Stale Recovery

## Status

Accepted

## Context

Monque can run multiple scheduler instances against one MongoDB collection. Only one
instance may process a job at a time, and crashed instances must not leave jobs stuck
forever.

## Decision

Jobs are claimed with atomic MongoDB updates from `pending` to `processing`. The claim
writes `claimedBy`, a unique `claimId`, `lockedAt`, `lastHeartbeat`, and `heartbeatInterval`.

Owned-job completion and failure require `status: processing` and `claimedBy` matching
the current scheduler instance, plus `claimId` matching the execution's claim. Release and
heartbeat writes also check the claim, so a reused scheduler ID cannot authorize an old
execution to mutate a newer claim.

Absolute locks use `lockedAt + lockTimeout` as the source of truth. Optional renewable
claims use `leaseExpiresAt`, set and renewed using MongoDB's clock. Expired renewable
claims cannot renew or record results. `lastHeartbeat` remains an observability and
instance-collision signal, not stale-recovery authority.

## Consequences

Race conditions concentrate in job state transition code.

Without leases, long-running jobs must set a lock timeout large enough for expected
processing time; recovery runs at initialization. Leases enable continuous recovery and
renewal during graceful shutdown. Applications must upgrade all schedulers sharing a
collection before enabling leases, because older versions only understand absolute locks.
