# Effect host example

This private workspace runs a native Effect Worker and hosts Management and Dashboard
with the existing Express adapters. It uses one scoped Monque instance: `.effects`
handles Worker registration and intake; the same instance supplies Management's
Promise interface. No published package changes or release bump are needed.

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

Both mounts, static assets, and OpenAPI discovery require authentication. Viewers
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

SIGINT and SIGTERM interrupt the application Effect. Its sequential scope closes
the HTTP listener, disposes Monque, closes the application MongoDB client, then
shuts down the optional provider. Failed startup releases already acquired resources.
Monque borrows the database; the host owns and closes the client.

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

The checks cover authentication, capabilities, action denial, read-only mode,
request protections, custom mounts, Dashboard assets and deep links, native Job
processing, optional tracing, and resource release order.
