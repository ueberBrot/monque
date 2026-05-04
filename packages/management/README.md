# @monque/management

Framework-neutral management surface for Monque.

`@monque/management` exposes the shared route map, DTO schemas, OpenAPI document, and
request handler used to build management APIs around a Monque scheduler. It does not ship an
HTTP server or framework adapter; adapters can mount the surface in Express, Fastify, Ts.ED, Hono,
or any other runtime.

## Installation

```bash
bun add @monque/management @monque/core
```

`@monque/core` is a peer dependency. Use the same Monque instance that owns the scheduler you want
to expose.

## Usage

```typescript
import { Monque } from '@monque/core';
import {
	HttpMethod,
	ManagementRoutePath,
	createManagementSurface,
	getManagementOpenApiDocument,
} from '@monque/management';
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();

const monque = new Monque(client.db('monque'));

const management = createManagementSurface({
	monque,
	readOnly: true,
	authorize: ({ action }) => action === 'read',
});

const response = await management.handle({
	method: HttpMethod.GET,
	path: ManagementRoutePath.HEALTH,
	context: undefined,
});

const openApiDocument = getManagementOpenApiDocument();

console.log(response.status, response.body, openApiDocument.openapi);
```

## Routes

| Method | Path | Operation | Description |
| ------ | ---- | --------- | ----------- |
| `GET` | `/api/v1/health` | `getSchedulerHealth` | Returns scheduler health. |
| `GET` | `/api/v1/capabilities` | `getCapabilities` | Returns read/write capabilities for the caller. |

Unknown routes return `404` with an error body.

## Authorization

Pass `readOnly: true` to disable write actions. Pass `authorize` to decide which actions a caller
can use for the provided request context.

```typescript
const management = createManagementSurface<{ role: 'admin' | 'viewer' }>({
	monque,
	authorize: ({ action, context }) => context.role === 'admin' || action === 'read',
});
```

The initial route set is read-only, but capabilities already model planned write actions:
`cancel`, `retry`, `reschedule`, and `delete`.

## OpenAPI

Use `getManagementOpenApiDocument()` to generate an OpenAPI 3.1 document from the package route
map and TypeBox schemas.
