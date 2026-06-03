# @monque/dashboard-express

Express adapter for serving the Monque Dashboard SPA.

`@monque/dashboard-express` is a UI-only serving adapter. It serves the built
`@monque/dashboard` assets, injects mount-aware runtime config into the Dashboard HTML,
provides SPA fallback routes, and leaves Management API mounting to the host application.

It does not mount the Management API, proxy API requests, or implement authentication.

## Installation

```bash
bun add @monque/dashboard-express @monque/management-express @monque/dashboard express
```

`express` is a peer dependency. `@monque/dashboard` is a direct dependency of this adapter.

## Usage

```typescript
import { createDashboardExpressRouter } from '@monque/dashboard-express';
import { createManagementExpressRouter } from '@monque/management-express';
import express from 'express';

const app = express();

app.use('/ops', requireOperator);
app.use(
	'/ops',
	createManagementExpressRouter({
		monque,
		openApi: false,
	}),
);
app.use(
	'/ops/dashboard',
	createDashboardExpressRouter({
		apiBaseUrl: '/ops/api/v1',
		pollingIntervalMs: 15_000,
	}),
);
```

The host owns composition:

- auth middleware wraps both routers
- `@monque/management-express` mounts the Management API
- `@monque/dashboard-express` serves only Dashboard UI assets and SPA routes

## Runtime config

The adapter injects:

- `basePath` from the Express mount path
- `apiBaseUrl` from the adapter option
- optional `pollingIntervalMs`

Dashboard HTML responses are served with `Cache-Control: no-store`. Hashed static assets under
`/assets/*` are served with `Cache-Control: public, max-age=31536000, immutable`.
