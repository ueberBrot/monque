# @monque/dashboard-express

Serve the Monque dashboard from an Express application, with support for nested mount paths
and direct links to jobs.

## Installation

Requires Node.js 22.12 or newer and Express 5.2.1 or newer within version 5.

```bash
bun add @monque/dashboard-express @monque/management-express @monque/management @monque/core express mongodb
```

The dashboard's built assets are included. No frontend build is required.

## Usage

Mount both routers using your initialized `Monque` instance:

```typescript
import { createDashboardExpressRouter } from '@monque/dashboard-express';
import { createManagementExpressRouter } from '@monque/management-express';
import express from 'express';

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

Open `http://localhost:3000/ops/dashboard`. The Management API is available under
`/ops/api/v1`, with OpenAPI JSON at `/ops/openapi.json`. Pass `openApi: false` to the
Management router to disable the OpenAPI endpoint.

See [`@monque/core`](../core/README.md) for scheduler setup and
[`@monque/management-express`](../management-express/README.md) for API options.

## Options

| Option              | Meaning                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apiBaseUrl`        | Required Management adapter mount URL, such as `/ops`. Also accepts a sync or async `({ req, res }) => string` resolver. |
| `pollingIntervalMs` | Optional positive integer in milliseconds. Omit to disable periodic polling.                                             |

The client appends API paths such as `/api/v1/jobs` to `apiBaseUrl`. The dashboard's own
base path is inferred from its Express mount. HTML is served with `Cache-Control: no-store`;
hashed assets use a one-year immutable cache.

## Optional authentication and permissions

The example allows unauthenticated access. To require authentication, mount your existing
middleware **before both routers**:

```typescript
app.use('/ops', requireOperator);
```

This protects dashboard pages, assets, API requests, and OpenAPI. Your application supplies
the login flow. Dashboard requests include browser credentials, so same-origin session cookies
work without additional dashboard configuration.

For action-specific permissions, pass the authenticated principal through the Management router's
`context` callback and check it in `authorize`. The API enforces permissions and the dashboard
disables unavailable actions. Set `readOnly: true` on the Management router to disable all
mutations. See the [Management options](../management/README.md) for authorization details.
