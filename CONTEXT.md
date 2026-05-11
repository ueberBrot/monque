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

**Dashboard** — bundled operator UI for inspecting Queue Views and operating Jobs through
the Management Route Map.
_Avoid_: dashboard server, management adapter

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
- The Dashboard is an asset/UI-only client package; serving it is outside the Dashboard
  package itself.
- Dashboard serving adapters are framework-specific packages that serve bundled Dashboard
  assets and SPA fallback; they are not Management Adapters.
- Dashboard serving adapters inject mount-aware runtime configuration, including the
  Management API base URL, so Dashboard assets do not need rebuilding per mount path.
- Dashboard serving adapters expose mount-aware options such as `basePath` and
  `apiBaseUrl`; host applications compose authentication middleware around them.
- Dashboard serving adapters serve only Dashboard UI assets and do not mount the Management
  API.
- Host applications compose Dashboard serving adapters with Management Adapters and should
  protect both UI and API mounts with authentication middleware when needed.
- Dashboard runtime configuration is strictly validated at app boot; production builds do
  not silently guess mount paths when config is missing.
- The Dashboard package ships an HTML template and hashed assets; serving adapters inject
  runtime configuration into the template and serve SPA fallbacks.
- The Dashboard package exports asset metadata and runtime config types for serving
  adapters; it does not expose a React component library in v1.
- Dashboard development uses an unpublished repo-local dev shell separate from the published
  asset/UI package.
- Dashboard development mock mode uses oRPC mock Management handlers backed by seeded,
  deterministic scenario factories.
- Dashboard tests use mock Management handlers for UI integration; real MongoDB/Testcontainers
  remain in core and Management integration tests.
- Dashboard releases require Playwright smoke coverage for routing, core workflows, and
  responsive layout sanity.
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
- Dashboard code imports Management Route Map type/runtime contract data from a
  browser-safe `@monque/management/contract` subpath, not from the Management Surface root.
- The Management contract subpath exports the runtime Management contract plus all
  Management DTO schemas and DTO types, but no server or Management Surface APIs.
- The Dashboard package may depend on `@monque/management` at runtime only through the
  browser-safe Management contract subpath.
- Dashboard packages that consume the Management contract are versioned and released with
  compatible Management contract changes.
- Dashboard implementation starts with Management contract and Dashboard-grade listing
  prerequisites before building the React UI.
- Dashboard work release order is core listing support, Management contract/query support,
  Dashboard asset package, then Dashboard serving adapter.
- The Dashboard uses the same REST-shaped Management Route Map routes as third-party HTTP
  clients; there is no separate RPC-shaped Dashboard API.
- The first Dashboard supports Queue Views, Job listing, Job details, scheduler health,
  capabilities, and existing Job actions from the Management Route Map.
- The first Dashboard uses Queue Views as its landing experience instead of synthetic KPI
  cards; broader Overview metrics wait for explicit observability APIs.
- The first Dashboard route set is Queue Views overview, Queue View detail by Job Name,
  global Jobs table, Job detail, and health/capabilities.
- Queue View detail shows Queue View summary information above the filtered Jobs table.
- The Dashboard provides route navigation for switching between primary operator views.
- The Dashboard uses a desktop sidebar and mobile drawer for primary navigation.
- The Dashboard v1 accessibility baseline includes keyboard-navigable core workflows,
  visible focus states, accessible action names, and non-color-only status communication.
- Dashboard routes are resource-based; Job actions are in-screen controls, not separate
  pages.
- Dashboard filters and selections use URL state where practical so operator views can be
  shared.
- Dashboard URL state and Management query parameters use the same names where practical;
  UI copy says Job Name even when the parameter is `name`.
- Queue View detail routes imply the Job Name filter from the route and do not expose a
  conflicting Job Name filter control.
- Dashboard tables expose only server-backed sorting and filtering; the Dashboard does not
  pretend to sort or filter beyond the current paginated result set.
- Dashboard row selection is local client state, not URL state, so shared URLs do not carry
  bulk-action selections.
- The first Dashboard bulk actions operate only on explicitly selected Jobs and require
  confirmation before execution.
- The first Dashboard supports only operator-safe hotkeys; destructive Job actions are not
  triggered directly by keyboard shortcuts.
- The first Dashboard command palette is limited to navigation and safe view actions, not
  destructive Job actions.
- The Management Route Map groups operations by resource and uses action endpoints for job
  state transitions.
- Management Adapters mount the oRPC OpenAPI HTTP handler instead of translating requests
  into a custom `ManagementRequest`/`ManagementResponse` abstraction.
- Management Adapters treat Management routers as opaque mountable handlers; capability
  discovery is exposed through the Management Route Map, not adapter route introspection.
- Job listing in the Management Route Map uses cursor pagination, not offset pagination.
- Job listing filters in the Management Route Map only expose filters supported by public
  cursor listing in core.
- Dashboard-grade Job listing requires server-backed date filters and whitelisted server
  sorting in core and the Management Route Map before the UI exposes those controls.
- The first Dashboard waits for Dashboard-grade Job listing rather than shipping a weak Jobs
  table with only name and status filters.
- Dashboard-grade cursor listing uses explicit whitelisted sort fields with a stable `_id`
  tie-breaker; the default management browsing order is newest-created Jobs first.
- Dashboard-grade cursor listing is added to core without breaking existing public
  `getJobsWithCursor` calls.
- Core cursor listing preserves public compatibility, while Management may explicitly choose
  a Dashboard-oriented default sort for browsing.
- Core owns practical index coverage for Dashboard-grade Job listing filters and sorts.
- Dashboard-grade Job listing exposes created, updated, and next-run date filters first;
  locked and heartbeat time filters are deferred.
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
- Dashboard payload display is read-only; payload redaction belongs to Management payload
  serialization, not Dashboard-side hiding.
- Dashboard date display uses `date-fns`; timezone conversion uses `@date-fns/tz` only when
  explicit timezone handling is needed.
- Dashboard reusable UI components are shadcn-first, including compatible shadcn ecosystem
  registries when they fit.
- Dashboard feature components may compose shadcn primitives around domain concepts; Tailwind
  is used for layout and local composition rather than hand-rolling reusable primitives.
- Dashboard forms use TanStack Form for non-trivial forms and Zod v4 validation where client
  validation is useful; simple controls do not require form machinery.
- Dashboard validation reuses Management contract schemas for API wire contracts and uses
  Dashboard-local schemas for UI state before serialization.
- Dashboard data fetching uses oRPC TanStack Query utilities inside the Dashboard package
  rather than hand-written API hook layers where generated utilities fit.
- Dashboard Job listing uses normal query options with explicit cursor URL state, not
  infinite-query behavior.
- Dashboard builds use Vite-compatible bundling with route-level code splitting and bundle
  visualization before release; the first Dashboard has no hard bundle byte budget.
- The first Dashboard supports light, dark, and system theme modes; deeper visual design is
  handled in the Dashboard implementation rather than domain policy.
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
- Dashboard polling is screen-aware and must preserve valid local row selections across
  refreshes.
- Management health starts as a simple scheduler health DTO; deeper diagnostics require
  public core read APIs first.
- Authentication belongs to the hosting application or Management Adapter; the Management
  Surface may enforce optional operation authorization hooks.
- Dashboard API requests include browser credentials by default, while authentication remains
  host-owned and no Dashboard login screen exists in v1.
- Dashboard uses standard TanStack Router pending, error, and not-found boundaries at the
  root with route-level overrides where needed.
- Dashboard error handling uses oRPC typed errors where possible so Management API failures
  map to specific operator-facing states.
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
