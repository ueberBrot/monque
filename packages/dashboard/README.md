# @monque/dashboard

A web dashboard for inspecting and managing Monque jobs, queues, and scheduler health.

- Filter jobs by queue, status, and date; sort and paginate results.
- Inspect job payloads, errors, and scheduling details.
- Retry, cancel, reschedule, or delete individual jobs and selections, subject to API permissions.
- Share URLs that preserve filters, date ranges, sorting, page size, and cursor.

Dates use the browser's local timezone. Shared date filters preserve the same instants across
timezones. Recipients need access to the same Management API to open shared views.

## Serve with Express

Use [`@monque/dashboard-express`](../dashboard-express/README.md) to mount the dashboard
alongside the Management API. The adapter includes this package and handles asset serving
and runtime configuration. No frontend build or separate React installation is required in
an application consuming the published packages.

For local development, see [`apps/dashboard-dev`](../../apps/dashboard-dev/README.md).

## Custom server integration

Requires Node.js 22.12 or newer.

```bash
bun add @monque/dashboard
```

The package provides built browser assets and server-side helpers; it has no React component API.
To serve it from another framework:

1. Serve the directory returned by `getDashboardAssetDirectory()` at your dashboard mount path.
2. Read the HTML from `getDashboardHtmlEntrypointPath()` and resolve its asset URLs against that
   mount path, including when serving nested routes.
3. Populate the `monque-dashboard-runtime-config` script before the application loads:

   ```javascript
   window.__MONQUE_DASHBOARD_CONFIG__ = {
     basePath: '/ops/dashboard',
     apiBaseUrl: '/ops',
     pollingIntervalMs: 15_000,
   };
   ```

4. Return the configured HTML for dashboard routes, including direct links to job details.
   Serve HTML without caching and hashed assets with immutable caching.

| Option              | Meaning                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `basePath`          | Dashboard mount path, such as `/ops/dashboard` or `/`.                |
| `apiBaseUrl`        | Management API mount URL. The client appends `/api/v1/...`.           |
| `pollingIntervalMs` | Optional positive integer; enables polling while the page is visible. |

Use `parseDashboardRuntimeConfig()` to validate and normalize configuration, or import
`DashboardRuntimeConfigSchema` and `DashboardRuntimeConfig` for schema and type access.
`getDashboardAssetMetadata()` exposes the script identifiers and asset filenames;
`getDashboardManifestPath()` locates the asset manifest.

Mount the Management API separately and protect both surfaces with your application's
authentication middleware. Browser requests include credentials for session cookies.
