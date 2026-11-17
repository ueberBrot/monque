# @monque/management-effect

Mount the complete Management Surface in a host-owned Effect HTTP server. The
package exports `createManagementEffectRoutes` (an HttpRouter layer),
`createManagementEffectHandler` (a request Effect), and `ManagementTransportError`.
Both RPC and public HTTP use the shared Management router and native operations.

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

Effect `4.1.4` and coordinated oRPC `2.0.0-beta.45` are the verified versions.
Effect HTTP interfaces are intentionally exposed despite their unstable status;
upgrade host and adapter together. The runtime graph contains no Express, Bun or
Node platform implementation. Private TCP tests use Bun only as a listener.
Do not infer cross-major oRPC RPC interoperability.

`prefix` defaults to root; trailing slashes are normalized. RPC lives at
`<prefix>/rpc`, public routes at `<prefix>/api/v1`, and discovery at
`<prefix>/openapi.json`. `openApi: false` disables discovery;
`openApi: { path: "/docs/openapi.json", serverUrl: "https://ops.example/management" }`
changes its location and advertised server. The host must authenticate the entire
mount, including discovery. HTTP discovery accepts GET/HEAD.

The host supplies its scheduler or native `ManagementEffects` facade, services,
identity, authentication, request scopes and runtime. Hook service requirements
remain in the returned Effect/layer type. Authorization, context and default or
per-Job-Name serializers can require host services. Per-name serializers take
precedence. Missing optional operations remain unsupported capabilities.
Read-only policy, action inputs, redaction, validation, origin checks and the
64 KiB default body limit are shared with Express on both transports.

Domain and hook failures stay in native Effect error channels until oRPC encodes
them. HTTP preserves `{ error }` and existing statuses; RPC uses its own serializer
and error envelope. Defects remain failures, never authorization grants. Context
factory failures remain in the host Effect error channel; request conversion and
transport dispatch failures use `ManagementTransportError`. Host middleware owns
how those failures become responses. Interruption remains interruption.

Each request captures the host Context, including Scope and tracing parent, for
the official oRPC Effect runner. That runner starts a separate fiber: context
provision does not promise arbitrary FiberRef inheritance. The adapter combines
client and host interruption signals, makes request work interruptible, and joins
the transport runner before the request Scope closes. Host middleware URL/header
changes are respected even when the platform preserves an original Web Request.
Use a fresh Scope for each request when mounting the handler directly.

Acquire shared resources before serving. On shutdown stop accepting requests and
interrupt/drain active work before disposing the scheduler, then close borrowed
MongoDB clients and application-owned telemetry. This adapter acquires none of
those resources and creates no scheduler, runtime, listener or process handlers.
Cancellation cannot roll back completed writes or guarantee cancellation of
admitted MongoDB I/O; scheduler disposal waits for owned operations (ADR-0007).

Verification from the repository root:

```sh
vp run --filter @monque/management-effect test
vp run --filter @monque/management-effect check:exports
vp run lint:effect
bun packages/management-effect/tests/consumer/verify.mts
```

The test task includes actual TCP RPC/HTTP lifecycle and complete-operation tests
with Docker Testcontainers (`mongo:8`, `directConnection=true`). The isolated
consumer packs core, Management and this adapter, installs them outside the
workspace, checks declarations, and mounts routes under Node without Express or
any Effect platform implementation.
