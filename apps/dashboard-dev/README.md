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

## Environment

- `MONQUE_DASHBOARD_DEV_MODE=mock|live`
- `MONQUE_DASHBOARD_DEV_SCENARIO=empty-state|pending-jobs|failed-jobs|large-dataset|unauthorized|mutation-conflict`
- `MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL=https://host.example`

Mock mode is the default. Live mode requires `MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL`.

## Notes

Playwright is repo-local dev and agent tooling only here. It is not part of any published
runtime dependency surface.
