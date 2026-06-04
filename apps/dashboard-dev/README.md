# @monque/dashboard-dev

Repo-local dev shell for `@monque/dashboard`.

It boots the dashboard package against deterministic mock Management handlers by default, while
keeping the browser client on the same `managementContract` + `OpenAPILink` path used in
production.

## Scripts

```bash
bun run dev
bun run build
bun run test:unit
bun run test:smoke
```

## Local modes

### Mock Management API

Default. No MongoDB required.

```bash
bun run dev
```

- `MONQUE_DASHBOARD_DEV_MODE=mock|live|db`
- `MONQUE_DASHBOARD_DEV_SCENARIO=empty-state|pending-jobs|failed-jobs|large-dataset|unauthorized|mutation-conflict`

### Live Management API

Proxies `/api` to an already running Management API.

```bash
MONQUE_DASHBOARD_DEV_MODE=live \
MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL=http://127.0.0.1:3000 \
bun run dev
```

- `MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL=https://host.example`

Live mode requires `MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL`.

### Local MongoDB Atlas

Runs the dashboard against a real `Monque` instance and a local MongoDB Atlas Local container.
Mock scenarios are not used in this mode.

Pinned image:

```text
mongodb/mongodb-atlas-local:8.2.6-20260529T125201Z
```

Docker Hub lists this as a concrete MongoDB Atlas Local 8.2.6 build. Do not replace it with
`latest`.

```bash
docker compose up -d
bun run dev:db
```

Or from the repo root:

```bash
docker compose -f apps/dashboard-dev/compose.yml up -d
bun run dev:dashboard-db
```

Defaults:

- `MONQUE_DASHBOARD_DEV_MONGO_URI=mongodb://127.0.0.1:27018/?directConnection=true`
- `MONQUE_DASHBOARD_DEV_DATABASE_NAME=monque_dashboard_dev`
- collection: `monque_dashboard_jobs`

Reset seeded data:

```bash
docker compose down -v
docker compose up -d
```

From repo root:

```bash
docker compose -f apps/dashboard-dev/compose.yml down -v
docker compose -f apps/dashboard-dev/compose.yml up -d
```

## Notes

Playwright is repo-local dev and agent tooling only here. It is not part of any published
runtime dependency surface.
