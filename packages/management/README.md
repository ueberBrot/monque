# @monque/management

Inspect jobs, read queue counts, and run job actions over HTTP. This package provides
RPC and HTTP handlers, an OpenAPI document, and Zod schemas with TypeScript types.
The route contract is also available to oRPC clients.

Use it with your own HTTP server. Express applications can mount the API with
`@monque/management-express` and add the browser interface with `@monque/dashboard-express`.
Effect applications can use [@monque/management-effect](../management-effect).

## Installation

```bash
bun add @monque/management @monque/core mongodb
```

`@monque/core` and `mongodb` are peer dependencies. Use the same `Monque` instance that owns
the scheduler you want to expose.

Requires `@monque/core` 1.15.1 or newer within version 1.
Job priority actions require core 1.18.0 or newer.

## Usage

```typescript
import { Monque } from "@monque/core";
import { createManagementSurface, generateManagementOpenApiDocument } from "@monque/management";
import { MongoClient } from "mongodb";

const client = new MongoClient("mongodb://localhost:27017");
await client.connect();

const monque = new Monque(client.db("monque"));
await monque.initialize();

const management = createManagementSurface({
  monque,
  readOnly: true,
  authorize: ({ action }) => action === "read",
});

const result = await management.openApiHandler.handle(
  new Request("https://example.com/api/v1/health", { method: "GET" }),
);

const openApiDocument = await generateManagementOpenApiDocument();

console.log(result.matched, openApiDocument.openapi);
```

Pass information from your authenticated session to `openApiHandler.handle()` as
`managementContext`:

```typescript
await management.openApiHandler.handle(request, {
  context: {
    managementContext: { userId: "operator-1" },
  },
});
```

## API

The API uses the `/api/v1` prefix:

| Method   | Path                                                 | Operation            |
| -------- | ---------------------------------------------------- | -------------------- |
| `GET`    | `/health`                                            | `getSchedulerHealth` |
| `GET`    | `/capabilities`                                      | `getCapabilities`    |
| `GET`    | `/processing?name=...` (optional job name)           | `getProcessingState` |
| `POST`   | `/processing/actions/pause`                          | `pauseProcessing`    |
| `POST`   | `/processing/actions/resume`                         | `resumeProcessing`   |
| `GET`    | `/queue-views?name=...` (optional exact name filter) | `listQueueViews`     |
| `GET`    | `/jobs`                                              | `listJobs`           |
| `GET`    | `/jobs/stats`                                        | `getJobStats`        |
| `GET`    | `/jobs/{id}`                                         | `getJob`             |
| `POST`   | `/jobs/{id}/actions/cancel`                          | `cancelJob`          |
| `POST`   | `/jobs/{id}/actions/retry`                           | `retryJob`           |
| `POST`   | `/jobs/{id}/actions/reschedule`                      | `rescheduleJob`      |
| `POST`   | `/jobs/{id}/actions/priority`                        | `setJobPriority`     |
| `DELETE` | `/jobs/{id}`                                         | `deleteJob`          |
| `POST`   | `/jobs/actions/cancel`                               | `cancelJobs`         |
| `POST`   | `/jobs/actions/retry`                                | `retryJobs`          |
| `POST`   | `/jobs/actions/delete`                               | `deleteJobs`         |
| `POST`   | `/jobs/actions/selected`                             | `selectedJobActions` |

Actions the scheduler does not support return `403`. They still appear in the OpenAPI document.
`readOnly: true` also keeps read endpoints available while write actions return `403`.

`GET /jobs?view=summary` returns job metadata with `payload: null`, without reading payloads
from MongoDB when supported by the scheduler. The default `view=full` and job detail retain
payload serialization and redaction.

For selected jobs, post `{ action: 'retry', ids: ['<MongoDB ObjectId>', ...] }` to
`/jobs/actions/selected`. Supports cancel, retry, delete, reschedule, and priority changes.
Reschedule requires `nextRunAt` as an ISO timestamp. For priority, send
`{ action: 'priority', ids: [...], priority: 10 }` to apply one signed safe integer to
every selected pending Job. At most 100 IDs are accepted before deduplication. Duplicate
IDs are handled once, with up to five actions at a time.

The API checks the bulk permission and then each Job's individual permission. The bulk
authorization input includes `ids`; per-Job checks include `job`. Reschedule and priority
changes use their individual permissions (`reschedule` and `setJobPriority`) for both checks.
The response contains `{ count, errors }`, with a status for every failed ID.
Successful changes remain even when another selected Job fails. Priority changes target
only the supplied IDs; filters and other pages never widen the selection.

Send `{ priority: 10 }` to `/jobs/{id}/actions/priority` to change one pending Job.
The operation keeps its scheduled time and returns the updated Job. Processing and
terminal Jobs return `409`; read-only mode, denied permission, or an unsupported scheduler
returns `403`. Check `actions.setJobPriority` in the capabilities response. See
[priority actions](https://ueberBrot.github.io/monque/management/surface/#change-one-jobs-priority)
for request examples, authorization, and partial results.

## Local processing controls

Read `/api/v1/processing`, then send its `instanceId` to the pause or resume endpoint:

```json
{ "instanceId": "scheduler-id-from-the-state-response", "name": "send-email" }
```

Omit `name` to control the whole attached scheduler. Running jobs continue and other
scheduler instances are unaffected. Resuming the instance preserves individual worker
pauses. A mismatched instance ID returns `409`; use instance-specific or sticky routing
when your application runs multiple schedulers.

The `pause` and `resume` authorization actions receive `name` and `instanceId`.
Read-only mode denies both. Query `/api/v1/capabilities?name=send-email` to check
permissions for one worker. Pauses are lost when the scheduler process exits.

Queue Views include effective local worker retry settings, pause state, and schema
presence. Jobs with renewable leases include their `leaseExpiresAt` deadline.

## Request cost and permissions

Core caches queue counts for `statsCacheTtlMs` (default 5 seconds), including Queue Views.
Concurrent reads share a query. Job actions clear the affected cached counts, while worker
registration and activity are read fresh. Set the core option to `0` to disable the cache.

Resolve shared permissions once in your adapter's request context, then reuse them in
`authorize`. For independent asynchronous permission checks, opt in to
`parallelCapabilityChecks: true` on the Management handler or Express router. The default checks
capabilities sequentially; authorization results are never shared between requests.

## OpenAPI

Use `generateManagementOpenApiDocument()` to generate an OpenAPI 3.1 document from the oRPC
contract. It includes every v1 route, even actions the configured scheduler does not support.
API errors use this response body:

```json
{ "error": "Message" }
```

## RPC and HTTP

`createManagementSurface()` creates one router for `rpcHandler` and `openApiHandler`.
Mount RPC under a distinct `/rpc` path, passing that path as `prefix`:

```ts
await management.rpcHandler.handle(request, {
  prefix: "/ops/rpc",
  context: { managementContext: authenticatedSession },
});
```

Both handlers share request protections and policy. Authenticate both mounts.
RPC errors use the oRPC error format; HTTP errors use `{ error: string }`.
DTO dates are ISO strings. RPC reads and writes use POST, including browser origin checks.
Express mounts `/rpc` beneath its Management mount.

## Compatibility

Use Management 0.12.x, Management Express 0.8.x, Dashboard 0.8.x and Dashboard
Express 0.5.x together. Management Effect requires Management 0.12.x; Dashboard
adapters include the 0.8.x renderer. Effect HTTP adapters require Effect 4.1.4.

Supported MongoDB drivers: ^6.22.0 || ^7.8.0.
