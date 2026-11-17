# @monque/management-effect

Mount Management in your Effect HTTP server with `createManagementEffectRoutes`
(an HttpRouter layer) or `createManagementEffectHandler` (a request Effect).
`ManagementTransportError` reports transport failures. RPC and HTTP share the
native Management router.

```ts
import { createManagementEffectRoutes } from "@monque/management-effect";
import { Effect } from "effect";
import { HttpRouter } from "effect/http";

const routes = createManagementEffectRoutes({
  monque: scheduler.effects, // the host's existing Scheduler Instance
  prefix: "/internal/management",
  context: () => CurrentIdentity, // host Context.Service
  authorize: ({ context, action }) =>
    Effect.succeed(context.role === "operator" || action === "read"),
  serializePayload: ({ payload }) => Effect.succeed(payload),
});
// Compose authentication middleware, routes and the host's platform listener.
// HttpRouter.serve(routes) is a Layer; provide the host HTTP server and services.
```

Requires Effect `4.1.4` and oRPC `2.0.0-beta.50`. Effect HTTP is unstable;
upgrade host and adapter together. See
[coordinated release compatibility](../management/README.md#coordinated-release-compatibility).
The adapter has no Express, Bun or Node platform runtime dependency.

`prefix` defaults to root and drops trailing slashes. Routes are `<prefix>/rpc`,
`<prefix>/api/v1` and `<prefix>/openapi.json` (GET/HEAD).
`openApi: false` disables discovery;
`openApi: { path: "/docs/openapi.json", serverUrl: "https://ops.example/management" }`
changes its path and advertised server.

Supply a scheduler or `ManagementEffects` facade, services, identity, authentication,
request scopes and runtime. Authenticate the entire mount, including discovery.
Hook service requirements propagate through Effect/layer types. Per-Job-Name
serializers override the default. Omitted methods remain unsupported capabilities.
Both transports share Management policy, including origin checks and the 64 KiB
body limit.

HTTP retains `{ error }` and existing statuses; RPC uses its native envelope.
Context failures stay in the host Effect error channel. Request conversion and
dispatch failures use `ManagementTransportError`; host middleware handles them.
Defects cannot grant access. Interruption remains interruption.

The oRPC runner receives request Context, Scope and tracing parent. Its separate
fiber does not guarantee arbitrary FiberRef inheritance. The adapter combines
client and host interruption, respects host URL/header changes, and joins the
runner before closing the Scope. Direct handlers need a fresh Scope per request.

Acquire resources before serving. On shutdown, stop HTTP and interrupt or drain
requests before disposing the scheduler, closing MongoDB and releasing telemetry.
Cancellation cannot undo writes or guarantee cancellation of admitted MongoDB I/O.
Disposal waits for owned operations (ADR-0007).

Run from the repository root with Docker available:

```sh
vp run --filter @monque/management-effect test
vp run --filter @monque/management-effect check:exports
vp run lint:effect
bun packages/management-effect/tests/consumer/verify.mts
```
