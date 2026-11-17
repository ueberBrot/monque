# @monque/management-effect

Mount Management in your Effect HTTP server with `createManagementEffectRoutes`
(an HttpRouter layer) or `createManagementEffectHandler` (a request Effect).
RPC and HTTP share the same authorization and serialization hooks.

## Installation

```sh
bun add @monque/management-effect @monque/management @monque/core mongodb effect@4.1.4
```

Requires Management 0.12.x and Effect 4.1.4. Provide your host's Node or Bun HTTP
server and platform services. See [compatibility](../management/README.md#compatibility).

## Usage

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

`prefix` defaults to root and drops trailing slashes. Routes are `<prefix>/rpc`,
`<prefix>/api/v1` and `<prefix>/openapi.json` (GET/HEAD).
`openApi: false` disables discovery;
`openApi: { path: "/docs/openapi.json", serverUrl: "https://ops.example/management" }`
changes its path and advertised server.

Supply `scheduler.effects` or a `ManagementEffects` facade, services, identity, authentication,
request scopes and runtime. Authenticate the entire mount, including discovery.
Hook service requirements propagate through Effect/layer types. Per-Job-Name
serializers override the default. Omitted methods remain unsupported capabilities.
Both transports share Management policy, including origin checks and the 64 KiB
body limit.

HTTP errors use `{ error: string }`; RPC uses the oRPC error format.
Context failures stay in the host Effect error channel. Host middleware handles
transport failures reported as `ManagementTransportError`. Direct handlers need
a fresh Scope per request.

Acquire resources before serving. On shutdown, stop HTTP and interrupt or drain
requests before disposing the scheduler, closing MongoDB and releasing telemetry.
Cancellation cannot undo writes already sent to MongoDB.

See the [Effect host example](../../examples/effect-host) for a complete application.
