# ADR-0009: Portable Management Effect adapter

Status: accepted

`@monque/management-effect` exposes Effect HTTP routes and a request Effect.
One protected native router serves RPC and OpenAPI. Existing synchronous and
Promise factories retain their contracts. The adapter converts requests and
bridges execution. The host owns the scheduler, services, identity,
authentication, scopes, runtime and listener.

The oRPC runner starts a separate fiber. Capture request Context/Scope, combine
client and host abort signals, and join transport completion before closing the
request scope. Forward the effective URL/headers, including host middleware
changes. Shutdown must finish HTTP work before releasing shared resources.
Admitted MongoDB writes retain ADR-0007's interruption semantics.

The router normalizes defects before oRPC squashes Effect causes. A defect
containing an oRPC error must neither become a declared domain failure nor expose
its details. Typed failures and interruption remain unchanged. Host Effect
wrappers still run.

Effect HTTP is unstable. Verified versions are Effect 4.1.4 and oRPC
2.0.0-beta.50. Platform implementations are test dependencies only. An isolated
packed Node consumer checks portability. Express and Effect share body limits,
trust state and protocol-specific error encoding in the surface module.

`packages/management-effect/tests/bun/lifecycle.test.ts` covers both transports,
concurrent identity isolation, request finalizers, tracing parents, client
interruption, runner termination, active-request shutdown and startup failure.
Keep these regressions against the shipped adapter instead of a separate
experimental host and dependency graph.
