# @monque/dashboard-dev

Development app for working on the Monque dashboard with mock data, local MongoDB,
or an existing Management API. Requires Bun and Node.js 22.12 or newer; MongoDB mode
and browser tests also require Docker with Compose.

To add the dashboard to your own application, use
[`@monque/dashboard-express`](../../packages/dashboard-express/README.md).
[View dashboard screenshots](../../packages/dashboard/README.md#screenshots).

## Getting started

From the repository root:

```bash
bun install
bun run build --filter=@monque/dashboard-dev
bun run dev:dashboard-dev
```

Open the URL printed by Vite, normally **http://localhost:3400**. This starts mock mode
without MongoDB. The Development selector provides populated, empty, read-only, and error scenarios.

## Local MongoDB

From the repository root:

```bash
docker compose -f apps/dashboard-dev/compose.yml up -d --wait
bun run dev:dashboard-db
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

| Variable | Default / purpose |
| --- | --- |
| `MONQUE_DASHBOARD_DEV_MODE` | `mock`; also supports `db` and `live`. The `dev:dashboard-db` command selects `db`. |
| `MONQUE_DASHBOARD_DEV_SCENARIO` | `pending-jobs`; initial mock scenario. |
| `MONQUE_DASHBOARD_DEV_MONGO_URI` | `mongodb://127.0.0.1:27018/?directConnection=true` |
| `MONQUE_DASHBOARD_DEV_DATABASE_NAME` | `monque_dashboard_dev` |
| `MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL` | Required in `live` mode; the existing Management router's mount URL. |

Mock scenarios: `pending-jobs`, `failed-jobs`, `large-dataset`, `empty-state`, `unauthorized`,
`forbidden`, `read-only`, `api-error`, and `mutation-conflict`.
Mock changes remain in memory until the server restarts.

To connect to a Management API mounted at `http://localhost:3000/ops`, set these values
in `apps/dashboard-dev/.env.local`:

```dotenv
MONQUE_DASHBOARD_DEV_MODE=live
MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL=http://localhost:3000/ops
```

Then run `bun run dev:dashboard-dev` from the root. The development server proxies API requests
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
bun run test:unit

docker compose up -d --wait
bunx playwright install chromium
bun run test:e2e
```

Browser tests build and serve the dashboard through Express with real MongoDB, covering desktop
and mobile with and without authentication. Each parallel worker reuses a server and an isolated
test database, resets data between tests, and removes its database on teardown. Development data
is unaffected. Set `MONQUE_DASHBOARD_TEST_MONGO_URI` to use a different MongoDB instance.

```bash
bun run test:e2e --project=mongo-desktop-auth
bun run test:e2e --workers=4
bunx playwright show-report
```

Projects: `mongo-desktop`, `mongo-mobile`, `mongo-desktop-auth`, and `mongo-mobile-auth`.
The default is two workers. Reports are in `playwright-report`; failure screenshots and traces
are in `test-results`. Both directories are ignored by Git.
