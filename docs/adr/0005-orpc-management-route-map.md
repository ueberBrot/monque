# ADR-0005: oRPC Management Route Map

## Status

Accepted

## Context

ADR-0004 established a versioned `/api/v1` Management Route Map, OpenAPI generation, and
framework-neutral Management Adapters. Its implementation choice was a Monque-owned route
map with TypeBox schemas and `openapi3-ts` document generation.

That shape keeps adapters framework-neutral, but it creates avoidable duplicate contract
definitions: DTO types, runtime schemas, route metadata, OpenAPI generation, and validation
all need to stay aligned by hand. The Dashboard also benefits from a first-party typed
TypeScript client while third-party clients still need a stable OpenAPI contract.

## Decision

Use an oRPC router as the implementation of the Management Route Map.

Management HTTP schemas use Zod v4. DTO TypeScript types are derived from those Zod schemas
rather than handwritten beside them.

`@monque/management` exports an OpenAPI document generated from the oRPC router. OpenAPI is
the stable interoperability contract for third-party clients. The Dashboard and other
TypeScript clients use RPC at `/rpc` beneath the Management mount. External HTTP
clients retain REST-shaped `/api/v1` routes under the same contract.

Management Adapters mount official oRPC RPC and OpenAPI HTTP handlers from one router.
They treat handlers as opaque and do not translate requests through custom
`ManagementRequest`/`ManagementResponse` types. Capability discovery remains a
Management Route Map endpoint.

The Management OpenAPI contract includes all v1 routes and does not vary by mounted
scheduler capabilities. Unsupported Management actions keep their route in the v1 contract
and return `403`; `/api/v1/capabilities` reports per-surface availability.

`@monque/management` uses oRPC server/OpenAPI packages and the official Effect integration.
The oRPC client runtime belongs to Dashboard or other client-side packages. `@monque/core` and `mongodb` remain peer
dependencies.

## Consequences

The Monque-owned `MANAGEMENT_ROUTE_MAP`, custom OpenAPI builder, TypeBox schemas, and
custom framework-neutral request/response abstraction are replaced by the oRPC router and
OpenAPI handler.

Adapters stay framework-specific mounting packages. They own mount-specific metadata such
as server URLs and documentation UI paths, but not route definitions, schemas, operation
IDs, or Management behavior.

Dashboard code uses oRPC types without duplicating the Management contract or operations.
Third-party clients can generate clients from OpenAPI.

The migration is allowed to break unreleased `@monque/management` exports, but should keep
domain-level names such as `createManagementSurface`, `getManagementOpenApiDocument`,
`ManagementOptions`, `ManagementMonque`, and exported DTO names where they still fit.

#686 verified oRPC `2.0.0-beta.45` with Effect `4.1.4`. Participating packages now pin
oRPC `2.0.0-beta.50` together. Procedures use official Effect handlers over shared
native operations; the Promise facade adapts to them. Hosts supply context,
request scope and cancellation. See the Management README and ADR-0009 for limits.

`createManagementSurface` shares request protections and policy across both
handlers. RPC uses native envelopes and POST for reads and writes, rejecting GET
mutations. OpenAPI preserves HTTP paths, methods, DTOs and `{ error }` bodies.
Authenticate requests before both transports. The Dashboard uses `RPCLink` at
`<management mount>/rpc`, imports only contract types and keeps ISO date strings.
