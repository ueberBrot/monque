# @monque/management

Framework-neutral, server-only Management Surface for Monque.

`@monque/management` exposes an oRPC OpenAPI handler, Zod-derived DTO schemas and types,
OpenAPI generation, and type-level router information. It does not ship an HTTP server,
framework adapter, documentation UI, dashboard, or oRPC client runtime.

## Installation

```bash
bun add @monque/management @monque/core
```

`@monque/core` and `mongodb` are peer dependencies. Use the same `Monque` instance that owns
the scheduler you want to expose.

## Usage

```typescript
import { Monque } from '@monque/core';
import { createManagementSurface, generateManagementOpenApiDocument } from '@monque/management';
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();

const monque = new Monque(client.db('monque'));

const management = createManagementSurface({
	monque,
	readOnly: true,
	authorize: ({ action }) => action === 'read',
});

const result = await management.openApiHandler.handle(
	new Request('https://example.com/api/v1/health', { method: 'GET' }),
);

const openApiDocument = await generateManagementOpenApiDocument();

console.log(result.matched, openApiDocument.openapi);
```

Framework adapters should create request context from their native request object and pass it
to `openApiHandler.handle()` as `managementContext`.

```typescript
await management.openApiHandler.handle(request, {
	context: {
		managementContext: { userId: 'operator-1' },
	},
});
```

## API

The v1 API is REST-shaped under `/api/v1` and includes:

| Method | Path | Operation |
| ------ | ---- | --------- |
| `GET` | `/health` | `getSchedulerHealth` |
| `GET` | `/capabilities` | `getCapabilities` |
| `GET` | `/queue-views` | `listQueueViews` |
| `GET` | `/jobs` | `listJobs` |
| `GET` | `/jobs/stats` | `getJobStats` |
| `GET` | `/jobs/{id}` | `getJob` |
| `POST` | `/jobs/{id}/actions/cancel` | `cancelJob` |
| `POST` | `/jobs/{id}/actions/retry` | `retryJob` |
| `POST` | `/jobs/{id}/actions/reschedule` | `rescheduleJob` |
| `DELETE` | `/jobs/{id}` | `deleteJob` |
| `POST` | `/jobs/actions/cancel` | `cancelJobs` |
| `POST` | `/jobs/actions/retry` | `retryJobs` |
| `POST` | `/jobs/actions/delete` | `deleteJobs` |

Unsupported scheduler actions remain in the OpenAPI contract and return `403` at runtime.
`readOnly: true` also keeps read endpoints available while write actions return `403`.

## OpenAPI

Use `generateManagementOpenApiDocument()` to generate an OpenAPI 3.1 document from the oRPC
contract. The generated document includes every v1 route independent of scheduler capability
support, and uses the deliberate Management error body shape:

```json
{ "error": "Message" }
```
