# ADR-0009: Portable Management Effect adapter

Status: accepted

`@monque/management-effect` exposes mountable Effect HTTP routes and a request
Effect. One native Management router and protected surface assembly supply RPC
and OpenAPI. Existing synchronous and Promise factories retain their contracts.
The adapter owns request conversion and the verified execution bridge; the host
owns scheduler, services, identity, authentication, scopes, runtime and listener.

The official oRPC runner starts a separate fiber. Capture request Context/Scope,
combine original and host abort signals, and join transport completion before
request scope closure. Forward effective Effect request URL/headers rather than
assuming a preserved Web source reflects host middleware changes. Host shutdown
must terminate HTTP work before releasing the scheduler and borrowed resources.
Admitted MongoDB writes retain ADR-0007's interruption semantics.

The shared router normalizes defects before the official oRPC runner squashes
Effect causes. A defect containing an oRPC error must not become a declared domain
failure or expose its details. Typed failures and interruption remain unchanged,
and host-supplied Effect wrappers still run.

The public Effect HTTP interfaces are unstable; Effect 4.1.4 and oRPC
2.0.0-beta.45 form the verified composition. Platform implementations are private
test dependencies only. A packed isolated Node consumer verifies portability.
The shared surface module owns body limits, trust state and protocol-specific
error encoding for both Express and Effect, keeping policy fixes local.

The initial compatibility experiment is covered by the shipped adapter's
`packages/management-effect/tests/bun/lifecycle.test.ts` regressions. They exercise
both real transports, concurrent identity isolation, request finalizers, tracing
parentage, client interruption, runner termination joining, active-request
shutdown and startup failure. Maintain those tests against the shipped adapter
rather than a separate experimental host and dependency graph.
