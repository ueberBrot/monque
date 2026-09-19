# @monque/dashboard-express

Serve the Monque dashboard from your Express application, alongside its Management API.
Includes the built dashboard, nested mount paths, and direct links to jobs.

[View screenshots](../dashboard/README.md#screenshots).

## Installation

Requires Node.js 22.12 or newer and Express 5.2.1 or newer within version 5.

```bash
bun add @monque/dashboard-express @monque/management-express @monque/management @monque/core express mongodb
```

No frontend build, React installation, or separate dashboard server is required.

## Usage

Add the routers to your existing Express app and reuse its initialized `Monque` instance.
For a new application, the following is a complete server entrypoint:

```typescript
import { Monque } from '@monque/core';
import { createDashboardExpressRouter } from '@monque/dashboard-express';
import { createManagementExpressRouter } from '@monque/management-express';
import express from 'express';
import { MongoClient } from 'mongodb';

const client = await MongoClient.connect('mongodb://localhost:27017');
const monque = new Monque(client.db('my-app'));
await monque.initialize();
monque.start();

const app = express();

app.use('/ops', createManagementExpressRouter({ monque }));
app.use(
	'/ops/dashboard',
	createDashboardExpressRouter({
		apiBaseUrl: '/ops',
		pollingIntervalMs: 15_000,
	}),
);

app.listen(3000);
```

Open **http://localhost:3000/ops/dashboard**. Register your application's workers before
`monque.start()` and enqueue or schedule jobs through Monque. On application shutdown,
call `await monque.stop()` before closing the MongoDB client.
See the [core README](../core/README.md) for workers and scheduling.

## Configuration

Configure the dashboard in `createDashboardExpressRouter()` in your server code.
There is no browser script or `window` object to configure manually.

| Setting | Example | Meaning |
| --- | --- | --- |
| Dashboard mount | `app.use('/ops/dashboard', …)` | URL where the dashboard is served; its base path is inferred automatically. |
| `apiBaseUrl` | `'/ops'` | Required Management router mount URL. The dashboard appends `/api/v1/...`. |
| `pollingIntervalMs` | `15_000` | Base job refresh interval while visible. Statistics and health refresh less often. Omit to disable periodic polling. |

**Do not include `/api/v1` in `apiBaseUrl`.** In the example, the jobs endpoint is
`/ops/api/v1/jobs`. The API and dashboard may use different mount paths.

`apiBaseUrl` also accepts a sync or async `({ req, res }) => string` resolver for
request-dependent URLs. Router options can come from your application's environment configuration;
no dashboard-specific environment variables are required.

The Management API exposes OpenAPI JSON at `/ops/openapi.json` in this example.
Pass `openApi: false` to `createManagementExpressRouter()` to disable it.

## Authentication and permissions

The example allows unauthenticated access. To require your application's existing login/session,
mount its middleware **before both routers**:

```typescript
app.use('/ops', requireOperator);
```

`requireOperator` is middleware supplied by your application. This mount protects the dashboard,
assets, API, and OpenAPI document. Browser API requests include credentials, so same-origin
session cookies work automatically. If you use separate mount prefixes, protect both.

Pass the authenticated principal through the Management router's `context` callback and check
permissions in `authorize`. For a read-only dashboard, pass `readOnly: true` to the Management
router. Permissions are enforced by the API and reflected in available dashboard actions.

See [Management Express](../management-express/README.md) for API configuration and
[Management](../management/README.md) for authorization options.

## Serving assets

Enable gzip or Brotli at your reverse proxy or through Express compression middleware mounted
before the routers. The adapter sets cache headers for fingerprinted assets; keep HTML and
runtime configuration uncached so configuration changes take effect on reload.
