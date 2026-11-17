# @monque/management

Inspect jobs, read queue counts, and run job actions over HTTP. This package provides
RPC and HTTP handlers, an OpenAPI document, and Zod schemas with TypeScript types.
The route contract is also available to oRPC clients.

Use it with your own HTTP server. Express applications can mount the API with
`@monque/management-express` and add the browser interface with `@monque/dashboard-express`.
The package runs on the server; it does not include an oRPC client runtime.

## Installation

```bash
bun add @monque/management @monque/core mongodb
```

`@monque/core` and `mongodb` are peer dependencies. Use the same `Monque` instance that owns
the scheduler you want to expose.

Requires `@monque/core` 1.15.1 or newer within version 1. Use core 1.18.0 or newer
to change Job priorities. Older supported core versions expose effective worker policies
and renewable lease deadlines; the priority action is unavailable.

## oRPC compatibility

Management and the bundled Dashboard use the coordinated `2.0.0-beta.45` oRPC
contract, server, OpenAPI, Zod, client, and TanStack Query packages. Upgrade them
together. The Dashboard connects through RPC at `<Management mount>/rpc`; public
`/api/v1` paths, DTOs, status codes, coercion and `{ error: string }` bodies remain
compatible. This does not promise cross-major oRPC interoperability.

Direct oRPC consumers must adopt v2 names (`RouterContractClient`,
`ContractedRouter`, `OpenAPIV3_1.OpenAPIObject`). `OpenAPILink` and `JsonifiedClient`
now come from `@orpc/openapi` and `@orpc/openapi/fetch`; Zod conversion comes from
`@orpc/zod`. v2 `ORPCError` carries a code rather than an HTTP `status`; use
`COMMON_ERROR_STATUS_MAP` at an HTTP presentation seam. These changes do not
change the public HTTP error body.

`createNativeManagementRouter(options)` accepts `NativeManagementOptions`,
including the supplied Scheduler Instance's `monque.effects` and Effect-returning
authorization and default/per-Job-Name serialization hooks. It implements the same
contract through official `.effect` handlers, without calling Promise scheduler
methods internally. Existing `createManagementRouter` / `createManagementSurface`
remain synchronous and adapt existing boolean/Promise hooks and optional facades.

Native router hosts must supply `effect/context` with required application
services and the host-owned request Scope, plus `managementContext` when hooks
consume it. Pass the request abort signal through the transport. The official
bridge starts a separate root fiber: context provision does not automatically
inherit the HTTP fiber, arbitrary FiberRefs, or its lifetime. Effect HTTP adapters
must combine source and host interruption signals and join the transport Promise
in an uninterruptible finalizer before closing the request Scope. Supply tracing
context explicitly and release shared resources only after active requests finish.
The verified implementation and lifecycle constraints are recorded in
[ADR-0009](../../docs/adr/0009-portable-management-effect.md). No application Layer or
second Effect runtime is created by the router. Cancellation cannot undo writes
already admitted to MongoDB.

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

### Native Effect operations

`createNativeManagementOperations` exposes the same Management policy and DTO mapping
without a transport or Effect runner. Supply the existing Scheduler Instance's
`monque.effects`, or a `ManagementEffects` facade with optional methods omitted for
unsupported capabilities. Existing `createManagementSurface`, router imports, boolean/
Promise authorization, and Promise serializers remain supported with the versioned public HTTP interface.

```ts
import { createNativeManagementOperations } from "@monque/management";
import { Effect } from "effect";

const operations = createNativeManagementOperations<{ role: string }>({
  monque: monque.effects,
  authorize: ({ context, action }) =>
    Effect.succeed(context.role === "operator" || action === "read"),
  serializePayload: ({ payload }) => Effect.succeed(payload),
});

const request = operations.jobs({ view: "summary" }, { role: "viewer" });
```

Authorization and default/per-Job-Name serializers may require application Effect
services. Their requirements propagate through the returned Effects; the host supplies
those services, request identity, scope, and interruption. Redaction is skipped for
summary projections, which omit payloads. Per-Job-Name hooks override the default.
Read-only policy and supported-method capabilities apply to all native mutations,
including selected and selector-based bulk actions. Bulk operations resolve their
scheduler method internally from the action.

Domain failures use the same oRPC error classification as the compatibility facade.
Other hook and scheduler failures remain in the Effect error channel; defects and
interruption remain distinct. Parallel authorization and serialization belong to the
calling fiber. No runtime, listener, authentication, or application layer is created.
Interruption does not roll back admitted database writes (ADR-0007). Mount native operations through `@monque/management-effect` for portable Effect HTTP
routes; the existing HTTP contract remains supported.

## RPC alongside public HTTP

`createManagementSurface()` creates one router for `rpcHandler` and `openApiHandler`.
Mount RPC under a distinct `/rpc` path, passing that path as `prefix`:

```ts
await management.rpcHandler.handle(request, {
  prefix: "/ops/rpc",
  context: { managementContext: authenticatedSession },
});
```

Both handlers enforce body limits, trusted origins and the same authorization,
capabilities, read-only and payload policies. Keep host authentication ahead of
both mounts. RPC failures use the official native envelope, while public HTTP
retains `{ error: string }`. DTO dates remain ISO strings. RPC requests use POST
for reads as well as writes, so browser calls must satisfy the origin policy.
The Express adapter mounts `/rpc` automatically beneath its configured mount.

## Coordinated release compatibility

Use Management **0.12.x**, Management Express **0.8.x**, Dashboard **0.8.x**,
and Dashboard Express **0.5.x** together. The new Effect adapters release as
**0.2.0** under `@monque/management-effect` and `@monque/dashboard-effect`.
Management Effect requires Management 0.12.x; Dashboard adapters require the
0.8.x shared renderer. Changesets updates their `workspace:^` Dashboard range
when versioning. Effect HTTP adapters require **Effect 4.1.4** and all oRPC
participants use **2.0.0-beta.45**. Old Management 0.11.x has no RPC handler or
native surface export; it cannot serve the new bundled Dashboard.

Core's existing Management compatibility facade still supports core 1.16.0
(the first published version satisfying ^1.15.1), with unsupported operations
reported through capabilities. Native examples and Ts.ED terminal teardown use
core **1.21.0+**. MongoDB drivers **^6.22.0 || ^7.8.0** remain supported.
These are projected unreleased versions until the coordinated release publishes.
