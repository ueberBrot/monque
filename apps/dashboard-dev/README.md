# @monque/dashboard-dev

Run the Dashboard locally with mock data, a MongoDB scheduler, or your own Management API.
This app is for repository development and is not published. Use Vite+ with the repository's pinned Bun and Node versions; MongoDB mode
and browser tests also require Docker with Compose.

To add the dashboard to your own application, use
[`@monque/dashboard-express`](../../packages/dashboard-express/README.md).
[View dashboard screenshots](../../packages/dashboard/README.md#screenshots).

## Getting started

From the repository root:

```bash
vp install
vp run @monque/dashboard-dev#build
vp run @monque/dashboard-dev#dev
```

Open the URL printed by Vite, normally **http://localhost:3400**. This starts mock mode
without MongoDB. The Development selector provides populated, empty, read-only, and error scenarios.

## Local MongoDB

From the repository root:

```bash
docker compose -f apps/dashboard-dev/compose.yml up -d --wait
vp run @monque/dashboard-dev#dev:db
```

This starts a scheduler and workers using MongoDB. A recurring demo creates work every
15 seconds, including successful jobs, a job that retries once, and a job that exhausts its retries.
External service calls are simulated. Fresh databases also receive 170 sample jobs.
Existing data is retained, and due jobs with registered workers can execute.

The database defaults to `monque_dashboard_dev`, with jobs in `monque_dashboard_jobs`.
The scheduler stops with the dev server.

## Configuration

The commands above work without an environment file. To change their settings, copy the
[example file](.env.example) from the repository root:

```bash
cp apps/dashboard-dev/.env.example apps/dashboard-dev/.env.local
```

Edit `apps/dashboard-dev/.env.local` and restart the dev server. This local file is
ignored by Git and loaded automatically by the development app. You can also set variables
in your shell. These settings apply only to this development app; applications using
`@monque/dashboard-express` configure the router in their own server code.

| Variable                                 | Default / purpose                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `MONQUE_DASHBOARD_DEV_MODE`              | `mock`; also supports `db` and `live`. The `vp run @monque/dashboard-dev#dev:db` command selects `db`. |
| `MONQUE_DASHBOARD_DEV_SCENARIO`          | `pending-jobs`; initial mock scenario.                                                                 |
| `MONQUE_DASHBOARD_DEV_MONGO_URI`         | `mongodb://127.0.0.1:27018/?directConnection=true`                                                     |
| `MONQUE_DASHBOARD_DEV_DATABASE_NAME`     | `monque_dashboard_dev`                                                                                 |
| `MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL` | Required in `live` mode; the existing Management router's mount URL.                                   |

Mock scenarios: `pending-jobs`, `failed-jobs`, `large-dataset`, `empty-state`, `unauthorized`,
`forbidden`, `read-only`, `api-error`, and `mutation-conflict`.
Mock changes remain in memory until the server restarts.

To connect to a Management API mounted at `http://localhost:3000/ops`, set these values
in `apps/dashboard-dev/.env.local`:

```dotenv
MONQUE_DASHBOARD_DEV_MODE=live
MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL=http://localhost:3000/ops
```

Then run `vp run @monque/dashboard-dev#dev` from the root. The development server proxies API requests
to that URL; do not append `/api/v1`. Actions affect that API's data.

Automatic refresh is one second in MongoDB mode and ten seconds in mock/live mode.
Applications using the Express package set their own `pollingIntervalMs`.

To reset the local Compose database, stop the dev server and run the following from the root.
This deletes all data in its MongoDB volumes:

```bash
docker compose -f apps/dashboard-dev/compose.yml down -v
docker compose -f apps/dashboard-dev/compose.yml up -d --wait
```

## Tests

Run from `apps/dashboard-dev`:

```bash
vp run test:unit

docker compose up -d --wait
vp exec playwright install chromium
vp run test:e2e
```

Browser tests exercise the Dashboard through Express and MongoDB on desktop and mobile,
with and without authentication. They use isolated databases and leave development data
untouched. Set `MONQUE_DASHBOARD_TEST_MONGO_URI` to use a different MongoDB instance.

```bash
vp run test:e2e --project=mongo-desktop-auth
vp run test:e2e --workers=4
vp exec playwright show-report
```

Projects: `mongo-desktop`, `mongo-mobile`, `mongo-desktop-auth`, and `mongo-mobile-auth`.
The default is four workers. Reports are in `playwright-report`; failure screenshots and traces
are in `test-results`. Both directories are ignored by Git.

The development Dashboard uses RPC at `/api/rpc`. Mock and database modes also
retain public HTTP fixtures. Live mode proxies `/api/rpc` to `<configured Management
mount>/rpc`, stripping the local `/api` prefix for RPC only. Public `/api/v1`
requests retain their path beneath the upstream mount. Configure the upstream Management
Surface to trust the development browser origin (for example `http://localhost:3400`)
when using the live proxy; POST reads are subject to origin checks too. The proxy
preserves browser Origin headers.

## Actual Express / Bun Effect host matrix

The separate `host-express` and `host-effect` projects start their own host subprocesses.
No manual server startup or Dashboard adapter selector is needed. Both serve the
same `packages/dashboard/dist` build through the actual serving adapters and use
actual Management RPC. `host-effect` runs the documented Effect example with BunRuntime;
the Express fixture runs with the repository's pinned Bun executable too.

From the repository root:

```sh
vp install --frozen-lockfile
# Start MongoDB once; each test owns a random database and ephemeral listener.
docker compose -f apps/dashboard-dev/compose.yml up -d --wait
(cd apps/dashboard-dev && vp exec playwright install chromium)
vp run @monque/dashboard-dev#test:hosts
vp run @monque/dashboard-dev#test:db
# All six projects:
vp run @monque/dashboard-dev#test:e2e
```

Set `MONQUE_DASHBOARD_TEST_MONGO_URI` to override the MongoDB connection; include
`directConnection=true` for a standalone `mongo:8` fixture. The host fixture waits
for the application's readiness log and an authenticated capabilities response,
reports early exits, bounds graceful shutdown with a kill/reap fallback, and drops
only its randomly named database after the process exits. Browser contexts isolate
operator, viewer and invalid credentials. Read-only and failed-policy variants
start separate processes. The failure variant embeds the same Effect host with a
failing native authorization hook; the ordinary project launches its unchanged CLI.

Shared workflows cover Job and Queue View deep-link reloads, real RPC reads and
mutations, pagination, polling, authentication, action denial, capabilities,
read-only enforcement and hook failure. Direct requests retain bypass checks.
Protocol conformance remains in Management request suites; signals and resource
lifetime remain in `examples/effect-host`'s actual Bun suite.

For an interactive second startup running the built Dashboard on Effect:

```sh
MONGO_URI='mongodb://127.0.0.1:27018/?directConnection=true' \
OPERATOR_PASSWORD=operator-secret VIEWER_PASSWORD=viewer-secret \
vp run @monque/dashboard-dev#start:effect
```

Open `http://127.0.0.1:3000/ops/dashboard` and sign in as `operator` or `viewer`.
The example README documents mount, port, database and read-only options. Mock
`dev`, MongoDB `dev:db`, live proxy and unit workflows remain available separately.
CI selects each of the six projects explicitly and installs Chromium before tests.
