# Monque Context

Monque is a MongoDB-backed job scheduler. It stores jobs in one collection and coordinates
workers across scheduler instances with atomic MongoDB writes.

## Domain Vocabulary

**Job** — persisted unit of background work. It has a name, payload, lifecycle status,
schedule time, retry metadata, and optional recurring schedule.

**Worker** — registered handler for one job name. Worker concurrency limits how many jobs
with that name can run at once in one scheduler instance.

**Job Name** — stable identifier that groups jobs for worker registration, filtering, and
operator views.
_Avoid_: queue, topic, task type

**Queue View** — operator-facing grouping by job name that can include persisted jobs and
registered workers.
_Avoid_: queue entity

**Management Surface** — framework-agnostic operator interface for inspecting jobs and
requesting public Monque management operations.
_Avoid_: dashboard API, agnostic API

**Management Adapter** — framework-specific package that exposes the Management Surface
through a server integration.
_Avoid_: dashboard plugin

**Management Route Map** — versioned HTTP contract implemented as an oRPC router and used
by Management Adapters, OpenAPI generation, and Dashboard clients.
_Avoid_: dashboard routes, adapter routes

**Scheduler Instance** — running Monque process identified by `schedulerInstanceId`.
It claims jobs, sends heartbeats, and releases ownership when work completes.

**Claim** — atomic transition from pending to processing. A claim writes `claimedBy`,
`lockedAt`, `lastHeartbeat`, and `heartbeatInterval`.

**Owned Job** — processing job whose `claimedBy` matches current scheduler instance.
Completion and failure transitions require ownership.

**Stale Job** — processing job whose `lockedAt` is older than `lockTimeout`. Stale recovery
resets it to pending and clears claim fields.

**Heartbeat** — liveness signal written to `lastHeartbeat` while a job is processing.
It supports monitoring and instance collision checks; stale recovery uses `lockedAt`.

**Pending Notification** — local signal that a pending job exists at `nextRunAt`.
Change streams, retries, reschedules, recurring completion, and intake use this to reduce
polling latency.

**Unique Key** — deduplication key scoped by job name and active statuses. Pending and
processing jobs block duplicates; completed and failed jobs do not.

**Retention** — optional cleanup policy for completed and failed jobs based on `updatedAt`.

## Load-Bearing Rules

- Claims and owned-job transitions use atomic MongoDB preconditions.
- A Queue View is derived from job names; it is not a persisted queue entity.
- The Management Surface is separate from the Dashboard; the Dashboard is one possible client.
- Framework-specific middleware belongs in Management Adapters, not in the Management Surface.
- Standalone Dashboard and Docker distribution come after the Management Surface and at least
  one Management Adapter.
- Express is the first Management Adapter.
- Ts.ED management support is a separate Management Adapter package, not part of
  `@monque/tsed`.
- Management Adapters may later serve Dashboard assets by composing with a Dashboard package.
- Management work starts with core query APIs and documentation, then Management Surface,
  then Express Adapter, then Dashboard.
- Public core APIs added for Management work are documented in the core documentation when
  they ship.
- The roadmap should describe Management Surface, Management Adapters, Dashboard, and Docker
  distribution as separate ecosystem steps.
- The Management Surface talks to public `Monque` methods, not directly to MongoDB.
- The first Management Surface manages one Monque instance per mounted surface.
- Management packages accept a user-provided Monque instance and treat `@monque/core` as a
  peer dependency.
- Management Surfaces create implemented oRPC routers through factories bound to
  `ManagementOptions`, not through singleton routers with baked-in scheduler state.
- The Management Surface exposes existing public Monque management operations before adding
  new operator behavior.
- The first Management Surface excludes job creation, worker registration, and scheduler
  lifecycle operations.
- Management read-only mode allows reads and rejects all mutations with `403`.
- The Management Route Map exposes capabilities so clients can reflect disabled actions.
- Unsupported Management actions keep their route in the v1 contract and return `403`;
  `/api/v1/capabilities` reports per-surface availability.
- Management capabilities combine static configuration and per-request authorization outcomes.
- The Management Surface validates its own HTTP request shape; job payload schema validation
  belongs to core job definitions.
- The first Management Surface manages existing jobs; operator-created jobs require core job
  payload schemas first.
- The Management Route Map is defined before the Dashboard, shared by adapters and clients,
  and uses an internal `/api/v1` prefix.
- The Dashboard uses the same REST-shaped Management Route Map routes as third-party HTTP
  clients; there is no separate RPC-shaped Dashboard API.
- The Management Route Map groups operations by resource and uses action endpoints for job
  state transitions.
- Management Adapters mount the oRPC OpenAPI HTTP handler instead of translating requests
  into a custom `ManagementRequest`/`ManagementResponse` abstraction.
- Management Adapters treat Management routers as opaque mountable handlers; capability
  discovery is exposed through the Management Route Map, not adapter route introspection.
- Job listing in the Management Route Map uses cursor pagination, not offset pagination.
- Job listing filters in the Management Route Map only expose filters supported by public
  cursor listing in core.
- Bulk job actions in the Management Route Map use a Management selector DTO that mirrors
  public core selector semantics and maps HTTP date strings to core `Date` values.
- Invalid job state transitions in the Management Route Map are conflicts, not validation
  failures.
- Management Route Map responses use DTOs instead of raw MongoDB/Core objects.
- Management DTO types are derived from Zod schemas rather than handwritten beside them.
- Successful Management Route Map responses return JSON DTOs, including delete actions.
- Bulk action DTOs preserve count and error fields.
- Management reschedule requests use ISO date strings.
- Management bulk date filters use ISO date strings.
- Management query arrays use repeated parameters.
- Management cursor listing defaults to a page size of 50 and caps page size at 100.
- Management DTOs expose failure reasons by default and expose job payloads through a
  configurable serialization boundary.
- Management payload serialization can be configured globally and per job name.
- Management payload serialization receives request or authorization context so payload
  visibility can vary per user.
- The Management Surface exports an OpenAPI contract derived from the Management Route Map;
  adapters may serve it but do not generate it independently.
- The Management OpenAPI contract includes all v1 routes and does not vary by mounted
  scheduler capabilities.
- The Management Route Map is implemented with oRPC.
- Management HTTP schemas use Zod v4.
- `@monque/management` uses oRPC server/OpenAPI packages only; oRPC client runtime belongs
  to Dashboard or other client-side packages.
- TypeBox and `openapi3-ts` are not part of the oRPC-based Management Surface.
- OpenAPI is the stable Management interoperability contract for third-party clients.
- The Dashboard and TypeScript clients may use oRPC typed clients against the same
  Management Route Map.
- Management Adapters serve OpenAPI JSON; Scalar API reference UI is optional adapter-level
  functionality and disabled by default.
- The Management Surface owns canonical OpenAPI paths, schemas, operation IDs, and package
  metadata; Management Adapters own mount-specific OpenAPI metadata such as server URLs and
  documentation UI paths.
- The first Management Route Map is request/response only; Dashboard freshness uses polling,
  not SSE or WebSocket.
- Management health starts as a simple scheduler health DTO; deeper diagnostics require
  public core read APIs first.
- Authentication belongs to the hosting application or Management Adapter; the Management
  Surface may enforce optional operation authorization hooks.
- The first Management Surface supports operation authorization, not Queue View visibility
  filtering.
- Management operation authorization is action-grained.
- Management operation authorization receives request context and the relevant job or selector
  when an action has a target.
- Management request context is generic at the Management Surface and created by
  Management Adapters from framework-native requests.
- Queue View visibility filtering is deferred until core supports the required scoped read
  APIs.
- Job statistics are job-resource endpoints; broader scheduler or worker diagnostics are
  separate resources.
- Queue View endpoints require public core query methods for job-name and worker-name
  summaries; the Management Surface does not compute them from MongoDB directly.
- Core exposes Queue Views through one combined summary method rather than separate job-name
  and worker-name primitives.
- Queue View summaries expose worker observability as immutable counts and limits, not
  internal worker maps or active job IDs.
- Worker observability appears through Queue View summaries in v1, not a separate worker
  resource.
- Queue View summaries include job statistics by default.
- Queue View summaries include historical-only job names and registered-worker-only job names.
- Queue View summaries are sorted by job name by default.
- Stale recovery uses `lockedAt + lockTimeout`, not `lastHeartbeat`.
- `lastHeartbeat` is still load-bearing for instance collision checks and observability.
- Public scheduler methods remain on `Monque`; internal modules hide persistence detail.
- Change streams are an optimization. Polling remains required as safety net and fallback.
