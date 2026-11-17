# Effect host example

Run a native Effect Worker, Management and Dashboard with BunRuntime,
BunHttpServer, `@monque/management-effect` and `@monque/dashboard-effect`.
One scoped Monque instance supplies native `.effects` to Workers and Management.
Bun dependencies stay in this private application. Effect and platform packages
are pinned to 4.1.4, and oRPC to 2.0.0-beta.45.

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
slashes. Dashboard injects both mounts at request time, so changing them needs no
rebuild. Deep links such as `/ops/dashboard/jobs/<id>` use the same assets.

Authentication covers both mounts, including assets, HTML deep links, RPC, HTTP
and OpenAPI. Host middleware supplies a request-local Identity for native context
and authorization hooks. Viewers can read; operators can mutate except for deletion.
Read-only mode denies operator mutations. Capabilities report these permissions.
No body parser or permissive CORS middleware bypasses the adapters' validation,
body limits or origin checks. Both mounts use the same Basic realm. If Management prompts separately,
use the same credentials.

## Optional tracing

Ordinary startup imports neither `src/tracing.ts` nor core's optional telemetry
entry. The example's telemetry packages are development dependencies; production
installations only need them for tracing. The integration requires the SDK metrics
peer even though this example exports no metrics.

Set `MONQUE_TRACING=true` to create a `BasicTracerProvider` with a console exporter.
`openTelemetry(provider)` passes it to Monque without global registration.
Configure your sampler, resource and exporters in `src/tracing.ts`.
To reuse a provider, pass `instrumentation` to `host()` and keep the provider's
scope outside the host scope. Monque never shuts it down. The example does not
configure metrics or persist producer trace context.

## Shutdown and verification

BunRuntime handles SIGINT and SIGTERM by interrupting the application Effect.
Its sequential scope closes HTTP, disposes Monque, closes the MongoDB
client, then shuts down the optional provider. Failed startup releases acquired
resources even if an embedder catches the failure and keeps its parent scope open.
The host owns the MongoDB client.

HTTP stops accepting requests, waits one second, then interrupts and joins
remaining request fibers and finalizers before releasing Monque. The listener's
idle timeout is 30 seconds. Logs report request completion and resource release
in this order.

Monque waits up to five seconds for active work during shutdown. Native Workers
that remain are interrupted at terminal scope release; finalizers and
uninterruptible work can delay disposal. Started MongoDB writes settle before
release. Interruption cannot undo writes or external effects. Incomplete Jobs
remain subject to the scheduler's fenced retry and Stale Job recovery rules;
shutdown does not guarantee completion or exactly-once external execution.

With Docker available and Playwright Chromium installed (`bunx playwright install chromium`
from `examples/effect-host`), run the MongoDB and HTTP integration tests:

```sh
vp run @monque/effect-host#test
vp run @monque/effect-host#lint:effect
```

Tests run `bun src/main.ts` with Testcontainers `mongo:8` and
`directConnection=true`, plus Chromium for Dashboard workflows.

For embedding, `host(options)` acquires a sequential child Scope and returns
`{ url, jobId, monque, db, client }`. Options are `mongoUri`, `databaseName`,
`operatorPassword`, `viewerPassword`, `managementPath`, `dashboardPath`, `port`
(zero selects a free port), optional `readOnly` and optional `instrumentation`.
The CLI logs `Dashboard: <url><dashboardPath>; Job: <id>` when ready.

The Dashboard polls every second. An optional native `authorize` hook replaces
the entire action policy and runs in the request Effect context. See [dashboard-dev](../../apps/dashboard-dev/README.md#actual-express--bun-effect-host-matrix)
for the Express/Bun browser matrix and interactive startup.
