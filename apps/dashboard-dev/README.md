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

The Dashboard uses `/api/rpc`. Mock and database modes also serve public HTTP
fixtures. Live mode maps `/api/rpc` to `<configured Management
mount>/rpc` and preserves `/api/v1` beneath the upstream mount. It forwards browser
Origin headers. Configure Management to trust the development origin, such as
`http://localhost:3400`, including for POST reads.

## Actual Express / Bun Effect host matrix

`host-express` and `host-effect` start hosts with the pinned Bun executable.
They serve `packages/dashboard/dist` through the adapters and Management RPC.
`host-effect` runs the Effect example CLI with BunRuntime.

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

Override MongoDB with `MONQUE_DASHBOARD_TEST_MONGO_URI`. Standalone `mongo:8`
requires `directConnection=true`. Tests use random databases and ephemeral ports,
then stop hosts and drop those databases.

The matrix covers deep-link reloads, RPC reads and mutations, pagination, polling,
authentication, denied actions, capabilities, read-only mode and failing native
authorization. Management suites cover protocol conformance;
`examples/effect-host` covers signals and resource lifetimes.

To run the built Dashboard on Effect interactively:

```sh
MONGO_URI='mongodb://127.0.0.1:27018/?directConnection=true' \
OPERATOR_PASSWORD=operator-secret VIEWER_PASSWORD=viewer-secret \
vp run @monque/dashboard-dev#start:effect
```

Open `http://127.0.0.1:3000/ops/dashboard` and sign in as `operator` or `viewer`.
See the example README for configuration. Mock `dev`, MongoDB `dev:db`, live proxy
and unit tests remain available. CI installs Chromium and runs all six projects.
