# @monque/dashboard-dev

Run the dashboard locally with mock data, MongoDB, or an existing Management API.
For production hosting, use [`@monque/dashboard-express`](../../packages/dashboard-express/README.md).

## Getting started

Install dependencies from the repository root:

```bash
bun install
bun run build --filter=@monque/dashboard-dev
cd apps/dashboard-dev
bun run dev
```

Open `http://localhost:3400`. Run the commands below from `apps/dashboard-dev`.

## Development modes

### Mock data

`bun run dev` starts without MongoDB. Use the Development toolbar to switch between populated,
empty, read-only, authentication-error, API-error, and mutation-conflict scenarios. Changes remain
in memory per scenario until the server restarts.

Set the initial scenario with `MONQUE_DASHBOARD_DEV_SCENARIO`:
`pending-jobs` (default), `failed-jobs`, `large-dataset`, `empty-state`, `unauthorized`,
`forbidden`, `read-only`, `api-error`, or `mutation-conflict`.

### Local MongoDB

Requires Docker with Compose.

```bash
docker compose up -d --wait
bun run dev:db
```

The app starts MongoDB-backed workers and refreshes the dashboard every second. Open **Health**
to check that the scheduler is healthy, then **Jobs** to watch jobs progress.

A cron job creates a new demo batch every 15 seconds:

| Job name | Behavior |
| --- | --- |
| `demo-email` | Processes for four seconds, then completes. |
| `demo-report` | Processes for six seconds, then completes. |
| `demo-webhook` | Fails once, retries, then completes. |
| `demo-failure` | Exhausts its retries and remains failed for inspection. |
| `demo-batch` | Creates the work above on startup and on its recurring schedule. |

Demo workers simulate work without contacting external services. Job states and scheduling are
real and persist in MongoDB. Recurring jobs return to Pending with their next run time after
each successful execution. Filter by a demo job name to follow its progress.

Fresh databases also receive 170 sample jobs for filtering and pagination. Existing records
are retained; due jobs with registered workers can execute. The scheduler stops when the dev
server closes. From the repository root, use `bun run dev:dashboard-db` to start this mode;
`bun run dev:dashboard-dev` starts mock mode instead.

| Environment variable | Default |
| --- | --- |
| `MONQUE_DASHBOARD_DEV_MONGO_URI` | `mongodb://127.0.0.1:27018/?directConnection=true` |
| `MONQUE_DASHBOARD_DEV_DATABASE_NAME` | `monque_dashboard_dev` |

Jobs are stored in `monque_dashboard_jobs`. Existing seeded databases retain their data.
To reset the Compose database, stop the dev server and run the following commands. This deletes
**all data in the Compose MongoDB volumes**:

```bash
docker compose down -v
docker compose up -d --wait
bun run dev:db
```

### Existing Management API

```bash
MONQUE_DASHBOARD_DEV_MODE=live \
MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL=http://127.0.0.1:3000 \
bun run dev
```

Requests under `/api` are proxied to the configured Management API mount URL. Actions affect
that API's data.

## Tests

Unit tests:

```bash
bun run test:unit
```

Browser tests require MongoDB and Chromium:

```bash
docker compose up -d --wait
bunx playwright install chromium
bun run test:e2e
```

The command builds and serves the production dashboard through Express, using real MongoDB.
It runs desktop and mobile scenarios with and without authentication, including job mutations,
shared URLs, scheduling, permissions, and session lifecycle.

Run a single project or change the default two parallel workers:

```bash
bun run test:e2e --project=mongo-desktop-auth
bun run test:e2e --workers=4
```

Available projects: `mongo-desktop`, `mongo-mobile`, `mongo-desktop-auth`, and `mongo-mobile-auth`.
Set `MONQUE_DASHBOARD_TEST_MONGO_URI` to use a different MongoDB instance. Each worker reuses an
Express server and an isolated test database, resets data between tests, and drops its database
on teardown. Tests leave the development database untouched.

Shared seed datasets and workers are in [`src/local-db/scenarios.ts`](src/local-db/scenarios.ts).
Reports are written to `playwright-report`; failure screenshots and traces to `test-results`.
Both directories are ignored by Git. Open the latest report with:

```bash
bunx playwright show-report
```
