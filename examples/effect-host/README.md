# Effect host example

This private workspace runs a native Effect Worker and hosts Management and Dashboard
with BunRuntime, BunHttpServer, `@monque/management-effect` and
`@monque/dashboard-effect`. One scoped Monque instance supplies native `.effects`
to both Workers and Management. Bun platform dependencies stay in this private
application; the published adapters remain portable. Effect and platform versions
are pinned to 4.1.4, with the coordinated oRPC 2.0.0-beta.45 transport.

## Run

Use the repository's pinned Bun and Vite+ versions. Start MongoDB, then run from the
repository root:

```sh
vp install --frozen-lockfile
vp run --filter './packages/*' build
OPERATOR_PASSWORD=choose-an-operator-password \
VIEWER_PASSWORD=choose-a-viewer-password \
vp run @monque/effect-host#start
```

Open `http://127.0.0.1:3000/ops/dashboard`. Sign in with HTTP Basic authentication
as `operator` or `viewer` and the corresponding password. The listener binds to
loopback. Use HTTPS and your application's identity/session system when adapting
this example for remote access. Do not put credentials in URLs.

Each startup enqueues a `receipt` Job. The native Worker captures an application
`Receipts` service, which upserts a receipt keyed by Job ID in the application's
`receipts` collection. MongoDB's unique `_id` makes that write safe to repeat.
Other external effects still need their own idempotency policy.

Configuration:

| Variable            | Default                                            | Meaning                                     |
| ------------------- | -------------------------------------------------- | ------------------------------------------- |
| `MONGO_URI`         | `mongodb://127.0.0.1:27017/?directConnection=true` | Application connection                      |
| `MONGO_DATABASE`    | `monque_effect_example`                            | Application database                        |
| `PORT`              | `3000`                                             | Loopback HTTP port                          |
| `MANAGEMENT_PATH`   | `/ops/control`                                     | Management mount                            |
| `DASHBOARD_PATH`    | `/ops/dashboard`                                   | Dashboard mount                             |
| `OPERATOR_PASSWORD` | required                                           | Operator password                           |
| `VIEWER_PASSWORD`   | required                                           | Viewer password                             |
| `READ_ONLY`         | `false`                                            | Set `true` to deny all Management mutations |
| `MONQUE_TRACING`    | `false`                                            | Set `true` for explicit console tracing     |

Mount paths must be distinct, non-overlapping absolute paths without trailing
slashes. Dashboard injects its base path and the separate Management mount at
request time. Deep links such as `/ops/dashboard/jobs/<id>` reuse the same assets.
No Dashboard rebuild is needed when changing either mount.

Both mounts, every static asset, HTML deep links, RPC, HTTP, and OpenAPI discovery
require authentication. One host middleware provides a request-local Identity;
native Management context and authorization hooks read that identity. Viewers
can read. Operators can mutate except for deletion. Read-only mode also denies
operator mutations; capabilities report these effective permissions. The adapters
retain the versioned Route Map, validation, error responses, body limits, and
origin protections. No body parser or permissive CORS middleware precedes them.
Browser authentication uses the same Basic realm for both mounts; sign in to
Management with the same credentials if your browser prompts there separately.

## Optional tracing

Ordinary startup never imports `src/tracing.ts` or the optional core telemetry
entry. The example's telemetry packages are development dependencies for this
opt-in demonstration; an ordinary production installation does not need them.
The optional integration also requires the SDK metrics peer, even when this host
does not export metrics.

Set `MONQUE_TRACING=true` to create an application-owned `BasicTracerProvider`
with a console exporter. `openTelemetry(provider)` passes that provider to Monque
without global registration. Replace the provider configuration in
`src/tracing.ts` with your application's sampler, resource, and exporters. A host
with an existing provider passes it through `instrumentation` to `host()` and
keeps its provider scope outside the host scope. Monque never shuts it down.
This example does not configure metrics or persist producer trace context.

## Shutdown and verification

BunRuntime handles SIGINT and SIGTERM and interrupts the application Effect. Its sequential scope closes
the HTTP listener, disposes Monque, closes the application MongoDB client, then
shuts down the optional provider. Failed startup releases already acquired resources,
including when an embedding application catches the failure and keeps its parent scope open.
Monque borrows the database; the host owns and closes the client.

HTTP stops accepting work, allows one second for active requests, then interrupts
and joins remaining request fibers and their finalizers before releasing Monque.
The listener has a 30-second idle timeout. Lifecycle logs report request completion
and HTTP → Monque → MongoDB → optional telemetry release.

Monque waits up to five seconds for active work during shutdown. Native Workers
that remain are interrupted at terminal scope release; finalizers and
uninterruptible work can delay disposal. Started MongoDB writes settle before
release. Interruption cannot undo writes or external effects. Incomplete Jobs
remain subject to the scheduler's fenced retry and Stale Job recovery rules;
shutdown does not guarantee completion or exactly-once external execution.

With Docker available and Playwright Chromium installed (`bunx playwright install chromium`
from `examples/effect-host`), run the real MongoDB and HTTP integration checks:

```sh
vp run @monque/effect-host#test
vp run @monque/effect-host#lint:effect
```

Tests launch `bun src/main.ts` as an actual subprocess with Testcontainers
`mongo:8` and `directConnection=true`. They cover HTTP/RPC authentication and
permissions, read-only mode, request protections, custom mounts, real assets,
native Job processing, connection/listener startup failures, SIGINT/SIGTERM,
active-request shutdown, and optional telemetry release order. Browser coverage
loads and reloads a Job deep link, verifies viewer denial, and performs an
operator mutation through the RPC Dashboard.

For embedding, `host(options)` acquires an internal sequential child Scope of the caller and
returns `{ url, jobId, monque, db, client }`. Stable options are `mongoUri`,
`databaseName`, `operatorPassword`, `viewerPassword`, `managementPath`,
`dashboardPath`, `port` (zero chooses a free port), optional `readOnly`, and optional
`instrumentation`. The CLI uses the environment variables above; its readiness log
is `Dashboard: <url><dashboardPath>; Job: <id>`. The dual-host matrix can launch
this command and use independent mount paths without a separate testing host.

The built Dashboard polls every second. Embedders may pass `authorize` as a native
Management authorization hook to replace the example's default role policy; that
hook owns the complete action policy and runs in the request Effect context.
The browser matrix uses a failing hook variant to verify failure-closed behavior.
For the shared actual Express/Bun browser matrix and a second interactive startup,
see [dashboard-dev](../../apps/dashboard-dev/README.md#actual-express--bun-effect-host-matrix).
