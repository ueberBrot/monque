# @monque/management-express

Serve the Monque Management API from Express. The router provides job queries and actions,
request context for permission checks, and an OpenAPI document.

Use your application's authentication middleware to protect it. To add the browser dashboard,
install `@monque/dashboard-express`.

## Installation

```bash
bun add @monque/management-express @monque/management @monque/core express
```

`@monque/core`, `@monque/management`, `express`, and `mongodb` are peer dependencies.

Requires `@monque/core` 1.12.0 or newer within version 1. Upgrade core alongside the adapter
so job details and actions can look up jobs by string ID.

## Usage

```typescript
import { Monque } from '@monque/core';
import { createManagementExpressRouter } from '@monque/management-express';
import express from 'express';
import { MongoClient } from 'mongodb';

const app = express();
const client = new MongoClient('mongodb://localhost:27017');
await client.connect();

const monque = new Monque(client.db('monque'));

app.use(
	'/monque',
	requireOperator,
	createManagementExpressRouter({
		monque,
		context: ({ req }) => ({
			userId: req.get('x-user-id') ?? 'anonymous',
		}),
		authorize: ({ action, context }) => {
			return context.userId !== 'anonymous' || action === 'read';
		},
	}),
);
```

If mounted at `/monque`, Management API routes are served under `/monque/api/v1/*`.
Authentication stays in the host Express app; mount auth middleware before the router.

## OpenAPI

OpenAPI JSON is served at `/openapi.json` relative to the mount path by default:

```text
/monque/openapi.json
```

The document describes the Management API and includes the router's mount URL in `servers`.

```typescript
app.use(
	'/internal/management',
	createManagementExpressRouter({
		monque,
		openApi: {
			path: '/docs/openapi.json',
			serverUrl: 'https://ops.example.com/internal/management',
		},
	}),
);
```

Set `openApi: false` to disable this route. You can load the document into an API viewer
such as Scalar; install the viewer separately.
