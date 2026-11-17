# @monque/management-effect

Mount Management in your Effect HTTP server with `createManagementEffectRoutes`.
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
  monque: scheduler.effects, // host-owned Scheduler Instance
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
and your HTTP server. Authenticate the entire mount, including discovery.
Per-Job-Name serializers override the default. Omitted methods report unsupported capabilities.
Both transports share Management policy, including origin checks and the 64 KiB
body limit.

HTTP errors use `{ error: string }`; RPC uses the oRPC error format.

See the [Effect host example](../../examples/effect-host) for a complete application.
