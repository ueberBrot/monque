# Shared rate limits per Job Name

Status: proposal for review. No rate limiting is implemented by this specification.
This local draft is ready to become a GitHub Issue after product decisions are approved;
it has not been published. Baseline: `468c5306bdca3c312d8daa801b7d0c28bdc0152d`.

## Problem and proposed contract

A Worker concurrency limit caps in-flight Jobs in one Scheduler Instance. Fast handlers
can exceed a provider's time-based quota even at concurrency one. Adding instances adds
independent capacity. Applications currently need their own shared request limiter.

Propose one shared token bucket per Job Name within a MongoDB database and Jobs
collection. Every Scheduler Instance using that collection draws from the same budget.
Separate collections and databases have separate budgets. Job Names use the collection's
existing equality and collation rules. Different names do not share a provider budget.

The budget counts successful admissions to processing, at the Claim boundary. One
admission costs one token, regardless of payload or runtime. This includes initial runs,
automatic retries, manual retries, recurring runs, and new Claims after stale recovery.
Enqueueing, deduplication, discovery, denied Claims, and heartbeat renewal cost nothing.

A Claim can commit before its handler runs. A process pause or a handler that sends many
requests can still produce a burst of external calls. The proposed guarantee therefore
bounds admission decisions, measured at MongoDB's decision timestamps. It does not bound
handler invocation timestamps, HTTP requests, or successful business effects. Applications
with strict provider quotas still need enforcement at the point of each request. Product
approval of this boundary is required before implementation.

## Implemented behavior to preserve

- [JobLifecycle](../../packages/core/src/scheduler/services/job-lifecycle.ts) atomically
  claims a due pending Job. Within a Job Name, it sorts by descending priority, ascending
  `nextRunAt`, then `_id`. Completion, failure, heartbeat, and release check ownership.
- [JobProcessor](../../packages/core/src/scheduler/services/job-processor.ts) applies
  Worker and instance concurrency locally. When instance capacity is capped, it rotates
  the starting Worker between passes. It does not promise equal service across instances.
- [PendingNotificationRouter](../../packages/core/src/scheduler/services/pending-notification-router.ts)
  combines local notifications, future wakeups, and polling. Change Streams reduce latency;
  polling remains the safety net, as required by
  [ADR-0002](../adr/0002-change-streams-with-polling-safety-net.md).
- Recovery can cause overlapping application executions. Absolute locks recover during
  initialization; enabling renewable leases also enables periodic recovery when
  `recoverStaleJobs` is true. See
  [ADR-0001](../adr/0001-job-ownership-and-stale-recovery.md).

Existing coverage includes [concurrency](../../packages/core/tests/integration/concurrency.test.ts),
[priority](../../packages/core/tests/integration/priority.test.ts),
[claim ownership](../../packages/core/tests/integration/claim-ownership.test.ts), and
[renewable leases](../../packages/core/tests/integration/renewable-leases.test.ts).
These tests establish the baseline; they do not establish the proposed rate-limit contract.

## Budget and burst behavior

Proposed policy fields are `limit`, `intervalMs`, and `burst`. All must be positive safe
integers. The refill rate is `limit / intervalMs` tokens per millisecond; bucket capacity
is `burst`. Require an explicit burst value so a provider quota cannot silently become a
large initial burst. There is no calendar-aligned reset and no fixed-window allowance.

Activation starts with a full bucket. Idle time refills only up to capacity. For example,
`limit: 10`, `intervalMs: 1000`, `burst: 2` permits two immediate admissions and then one
per 100 ms. A full bucket can admit up to 12 Jobs across a 1,000 ms span. It does not mean
“at most 10 in every rolling second.” With `burst: 1`, admissions are spaced by at least
100 ms on the bucket's clock. Pausing a Worker does not stop refill.

For an unchanged policy, the admission count over a time span of length `t` must not
exceed `floor(burst + limit * t / intervalMs)`. Measure this using committed decisions'
persisted admission timestamps, not local event receipt times. Transactions serialize
writes to the bucket. Recompute time after a transaction retry; clamp the decision time
to at least the bucket's previous timestamp to avoid refill on a backwards clock step.
A forward database-clock jump can refill up to capacity. Clock accuracy remains an
operational assumption, including across primary failover.

Use exact integer credit arithmetic: one token costs `intervalMs` credits and each
elapsed millisecond adds `limit` credits. Cap at `burst * intervalMs`; round wait times
up to the next millisecond. Validate arithmetic bounds, and cap elapsed time before
multiplication so long idle periods cannot overflow. Fractional tokens survive each
update. Do not use independent per-process buckets or periodically reconciled counters.

## Atomic admission and Claim

Propose a companion collection named from the configured Jobs collection, with one
unique record per Job Name. Each record stores the policy, revision, protocol version,
enabled flag, remaining credits, and last refill time. Precreate collections and indexes.
The policy and budget live in the same record so policy updates conflict with admission
writes. Keep rate-limit metadata out of the Jobs collection's ordinary Job queries.

In a short MongoDB transaction:

1. Read the authoritative policy record and compute budget using MongoDB server time.
   When disabled, follow the explicit disabled-policy path. A missing expected policy
   or unsupported protocol fails closed for that Job Name.
2. If budget exists, debit one token and select the highest-priority due Job with the
   existing Claim sort. Write the ordinary ownership fields plus `ratePolicyRevision`
   and `rateAdmittedAt`. Use a stable `claimId` for this admission attempt.
3. If no due Job remains, abort so no token is consumed. If budget is exhausted, leave
   Jobs pending and return a `rateLimited` result with the next eligible time.
4. Commit with majority write concern. Dispatch only after confirmed commit and the
   usual local pause, shutdown, and ownership checks. An expired renewable claim must
   not begin dispatch. Keep transaction callbacks free of handler calls and events.

Use snapshot read concern and primary reads. Every operation must use the same session.
The driver may retry the transaction callback. Publish `job:start` only when dispatch
actually begins, and distinguish it from admission telemetry. Do not turn a denied
admission into a Job failure, increment `failCount`, or rewrite `nextRunAt` to the bucket
refill time. Rate waiting is a property of the Job Name, not a new Job status.

Concurrency slots must be reserved locally while admission is in flight. Release that
reservation on denial or failure. Batched Claims each consume their own token; one
successful budget check cannot authorize a whole batch.

For collection-wide policy consistency, all Claims in an activated collection must use
the transactional protocol, including names without limits. The proposed registry has
explicit disabled records for those names; creating one races safely on its unique key.
Even an unlimited Claim must write the record's admission sequence, so concurrent policy
activation serializes with it. A fast path that skips this write could miss a new policy.
Collections that have never activated the feature keep the existing Claim path.

## Crashes, cancellation, and ambiguous outcomes

Never refund a committed admission. A crash after commit but before handler invocation
can waste a token. Shutdown, cancellation, invalid payloads discovered after claiming,
and an immediate handler error can also waste one. This favors a conservative budget and
avoids guessing whether a side effect happened. Normal refill restores capacity.

If the transaction aborts, neither the token debit nor Claim persists. Retry transaction
conflicts with bounded backoff and jitter; do not hold a local slot indefinitely. If
commit is ambiguous, retry the same commit through the driver's transaction protocol.
Do not start a new admission attempt merely because its response was lost.

If the commit result remains unknown after the retry deadline, emit a scheduler error,
release the local reservation, and do not dispatch that attempt. Leave any committed
Claim for normal expiry and recovery; a later Claim costs a new token. Do not refund or
execute based on a stale read. Rate limiting adds no exactly-once guarantee and does not
replace idempotent handlers. Disabling recovery can leave an abandoned Claim processing
indefinitely, just as it can today.

## Priority, fairness, and wakeups

Apply the budget before dispatching the next due Job in the existing priority order.
Priority never bypasses the bucket. Future high-priority Jobs must not block due Jobs;
continuous urgent work can still starve low-priority work within one Job Name.

An exhausted name must not consume active concurrency or stop discovery of other names.
Preserve local rotation between Workers. This version makes no equal-share guarantee
between Scheduler Instances, tenants, or payloads. A fast instance may win most tokens.
Weighted admission, tenant keys, and global priority across names are out of scope.

Schedule a targeted wakeup for the later of the next due Job and the bucket's next token.
For an already due backlog, use the token deadline. A notification for an exhausted name
must not trigger a tight retry loop. Keep one coalesced deadline per name, bounded state,
and a positive retry floor. Hints can postpone work but cannot authorize it: recheck the
bucket transactionally at every admission.

Policy changes invalidate local rate-wait hints and notify affected schedulers through
Change Streams when available. Polling must refresh policy state and retry waiting names
when streams are absent or lost. Earlier policy deadlines may shorten a wakeup; repeated
job notifications must not postpone it. A hot throttled name must not delay the existing
full-discovery safety deadline or unrelated due names.

## Policy ownership and changes

Propose a single authoritative persisted policy managed through an explicit administrative
operation. Worker registration neither creates a limit implicitly nor overwrites one.
Optional startup assertions may reject a mismatched expected revision. Multiple instances
must not resolve conflicting configuration by “last startup wins.”

Create, replace, and disable operations require an expected revision and return a conflict
on a stale revision. Apply each change atomically with bucket state. Record actor, change
time, and old and new policy in durable administrative history. Keep a disabled tombstone
so deleting a record cannot accidentally remove protocol requirements.

On replacement, refill under the old policy up to the change timestamp, convert the
remaining credit to the new units with rounding down, and cap at the new burst capacity.
Do not grant a fresh burst on each edit. On first activation, grant the configured burst;
on re-enabling a disabled policy, start empty. Disabling permits future admissions without
a budget; it does not cancel running Jobs. Already committed admissions use their old
revision. A lower rate cannot retract earlier admissions, so limits across a policy-change
boundary are piecewise, not a retroactive guarantee.

## MongoDB constraints and upgrades

The proposed atomic debit and Claim require multi-document transactions. Standalone
MongoDB cannot support this mode. First release: support unsharded Jobs and policy
collections on replica sets, on the MongoDB versions supported and tested by Monque.
Reject unsupported topology before activation. Sharded support needs a separate design
for shard keys, unique policy identity, and cross-shard transaction cost.
MongoDB documents these constraints in its
[transaction production considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

Require permissions for the companion collections, their unique indexes, and transaction
writes. Honor `skipIndexCreation` by documenting the complete managed-index migration.
Keep Claim and deadline indexes. Benchmark hot-name contention: all admissions for one
name serialize on one record, even when many instances have capacity. Set bounded
transaction and commit timeouts; no database failure may silently bypass the limit.

Activation requires a controlled upgrade. Old binaries ignore policy records and can
claim without paying, so their continued presence invalidates the guarantee. Deploy the
new version with shared admission disabled, stop and drain all claiming instances, create
protocol metadata, then activate and restart only compatible claimers. Inventory producer
processes that can also claim or perform recovery. Old enqueue-only producers may remain
if their Job schema is otherwise compatible; they must not start processing.

New binaries must reject unsupported protocol versions. Feature-aware Claims validate
persisted protocol metadata rather than trusting a process flag. A metadata record cannot
force an old binary to cooperate: prevent old workers from reconnecting through deployment
controls or database credential rotation. Automatic rollback to an old claimer is unsafe.
To roll back, stop all claimers, explicitly disable enforcement, then restart. Keep budget
records across ordinary restarts; never reset them as part of initialization or retention.

## Management Surface and Dashboard

Add a read model per Queue View with policy, revision, enabled state, burst, refill rate,
observation time, estimated available tokens, and earliest eligible time. These are
snapshots, not reservations or a promise that this instance will win the next token.
Keep local Worker concurrency and active counts visibly separate from the shared policy.

Expose administrative create, replace, and disable operations through the Management
Surface and versioned Management Route Map. Apply authorization, `readOnly`, validation,
and revision-conflict responses in every Management Adapter and generated OpenAPI contract.
The Dashboard should explain a rate wait, show its estimated end, and link to the policy.
Do not label every pending Job “rate limited”: scheduled time and concurrency can also
prevent a Claim.

Propose read-only Dashboard exposure first, with policy changes available through the
protected Management Surface. Later editing UI can show the concrete old and new policy
before submission. Existing cancel, retry, reschedule, and priority actions do not bypass
admission. Emit separate admission, denial, transaction-error, and ambiguous-commit metrics.
Avoid Job IDs as metric labels, and bound Job Name label cardinality. Existing `job:start`
events alone cannot prove budget compliance because delivery follows commit.

## Acceptance scenarios

1. Three instances race with a full two-token bucket and a due backlog. Exactly two
   admissions succeed before refill, with distinct owned Claims and two token debits.
2. With 10 tokens per second and burst two, the third immediate admission waits. One
   token is available after 100 ms; idle time never grows capacity beyond two. Check the
   envelope at boundary timestamps and with fractional token accumulation.
3. No due Jobs, a cancelled candidate, a lost Claim race, or an aborted transaction leaves
   no debit. A committed Claim released during shutdown retains its debit.
4. Kill a worker before commit, after commit, and before dispatch. Inject lost commit
   responses and primary failover. No handler starts on an unresolved commit; recovery
   requires a new paid Claim. Never issue an automatic refund.
5. Retries, recurring runs, recovered Claims, and Management retries each pay once per
   committed admission. Enqueue deduplication and denied Claims pay zero.
6. An urgent due Job wins within its name when a token becomes available. Future urgent
   Jobs do not block overdue Jobs. A throttled name does not occupy a slot or starve an
   unrelated due name under instance concurrency one.
7. With Change Streams off or disconnected, polling still discovers refill and policy
   changes. Repeated notifications produce bounded retries and no busy loop. Clock skew
   on application hosts cannot create extra tokens; database clock jumps obey the stated
   capacity and clock assumptions.
8. Two administrators update the same revision. One succeeds, one conflicts. A rate
   reduction preserves spent capacity; edits do not reset the burst. Claims racing with
   enable, disable, and replace serialize before or after the revision change.
9. Restart all compatible instances without resetting the bucket. Standalone topology,
   missing expected metadata, unavailable MongoDB, and unknown protocols fail closed.
   Demonstrate that an old binary bypasses enforcement and validate the deployment
   exclusion procedure before declaring mixed-version activation safe.
10. Management reads expose shared state without implying local ownership. Unauthorized
    and read-only callers cannot change policies. Dashboard waiting states distinguish
    rate, schedule, pause, and concurrency, and refresh after policy changes.

## Implementation slices

1. Approve the contract and decisions below. Add focused domain terms and an ADR for the
   companion collection and transactional Claim path, extending ADR-0001 explicitly.
2. Implement policy persistence, integer budget arithmetic, revision changes, protocol
   checks, and managed indexes. Test arithmetic boundaries and concurrent policy edits.
3. Add atomic admission to JobLifecycle, preserve ownership checks, and reserve local
   slots around it. Test contention, aborts, ambiguous commits, and crash recovery on a
   real replica set. Keep handler execution outside transactions.
4. Integrate denial results with discovery and pending notifications. Test priority,
   fairness between names, stream loss, and timer bounds. Measure hot-name throughput and
   the cost of unlimited names in an activated collection before setting release limits.
5. Add Management contracts, authorization, read-only Dashboard state, and telemetry.
   Validate adapters, generated OpenAPI, and UI states together.
6. Document and rehearse activation and rollback, including exclusion of old claimers.
   Publish guarantees and measured constraints only after acceptance tests pass.

## Decisions requiring approval

- Accept admission-based accounting and conservative lost tokens, or require limits at
  actual handler/request start? The latter changes the boundary and cannot be guaranteed
  solely by a database Claim transaction.
- Approve token-bucket bursts with an explicit `burst`, or require a strict rolling-window
  quota? These allow different traffic patterns and need different algorithms.
- Accept replica-set-only, unsharded support and a companion collection for the first
  release, including transactional overhead for unlimited names after activation?
- Approve persisted administrative ownership, revision-based changes, empty re-enable,
  and a read-only Dashboard first? Registration-based policy ownership is an alternative
  but needs deployment conflict rules before it can be specified safely.
- Is per-Job-Name scope sufficient? A provider budget shared across names or tenants needs
  an explicit grouping model; it must not be implied by this contract.
