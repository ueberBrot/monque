# Effect host example

Run a native Effect Worker, Management and Dashboard with BunRuntime,
BunHttpServer, `@monque/management-effect` and `@monque/dashboard-effect`.
One scoped Monque instance supplies native `.effects` to Workers and Management.

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
Other external effects need their own idempotency policy.

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

Set `MONQUE_TRACING=true` to create a `BasicTracerProvider` with a console exporter.
`openTelemetry(provider)` passes it to Monque without global registration.
Configure your sampler, resource and exporters in `src/tracing.ts`.
To reuse a provider, pass `instrumentation` to `host()` and keep the provider's
scope outside the host scope. Monque never shuts it down. The example does not
configure metrics or persist producer trace context.

## Shutdown

BunRuntime handles SIGINT and SIGTERM. Shutdown stops HTTP requests, disposes
Monque, closes MongoDB, then releases the optional tracing provider.

Monque waits up to five seconds for active work before interrupting native
Workers. Finalizers and uninterruptible work can delay shutdown. Cancellation
cannot undo MongoDB writes or external effects; incomplete Jobs remain subject
to retry and Stale Job recovery.
