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
TypeScript clients use oRPC RPC against the same contract and operations at `/rpc`
beneath the Management mount; external HTTP clients retain REST-shaped `/api/v1` routes.

Management Adapters mount the official oRPC RPC and OpenAPI HTTP handlers from one router. They do not translate requests into
a custom `ManagementRequest`/`ManagementResponse` abstraction, and they treat Management
routers as opaque mountable handlers. Capability discovery remains a Management Route Map
endpoint.

The Management OpenAPI contract includes all v1 routes and does not vary by mounted
scheduler capabilities. Unsupported Management actions keep their route in the v1 contract
and return `403`; `/api/v1/capabilities` reports per-surface availability.

`@monque/management` uses oRPC server/OpenAPI packages and the official Effect integration. oRPC client runtime belongs to
Dashboard or other client-side packages. `@monque/core` and `mongodb` remain peer
dependencies.

## Consequences

The Monque-owned `MANAGEMENT_ROUTE_MAP`, custom OpenAPI builder, TypeBox schemas, and
custom framework-neutral request/response abstraction are replaced by the oRPC router and
OpenAPI handler.

Adapters stay framework-specific mounting packages. They own mount-specific metadata such
as server URLs and documentation UI paths, but not route definitions, schemas, operation
IDs, or Management behavior.

Dashboard code can use oRPC for first-party TypeScript developer experience without
duplicating the Management contract or operations. Third-party clients can continue to generate
clients from OpenAPI.

The migration is allowed to break unreleased `@monque/management` exports, but should keep
domain-level names such as `createManagementSurface`, `getManagementOpenApiDocument`,
`ManagementOptions`, `ManagementMonque`, and exported DTO names where they still fit.

## Coordinated oRPC v2 adoption (#689)

The compatibility gate in #686 passed with oRPC `2.0.0-beta.45` and Effect `4.1.4`.
All participating workspace packages now pin that oRPC release together. One
procedure implementation uses official Effect handlers over shared native
Management operations; the existing Promise facade adapts at that same seam.
The native router requires host-supplied Effect context, request scope and
cancellation ownership. See the Management README and proof for execution limits.

## Dual transport (#690)

The Dashboard now connects through `RPCLink` at `<management mount>/rpc`.
`createManagementSurface` creates one router and protects both official handlers
with shared body limiting, origin classification and request context. Authorization,
capabilities, read-only mode, redaction, validation and operations stay in the shared
router. RPC retains native envelopes; the public HTTP `{ error }` encoder applies
only to OpenAPI. RPC uses POST, including reads, and does not admit GET mutations.
Host authentication middleware runs before either transport.

Direct oRPC consumers use the coordinated beta release. Public HTTP clients retain
paths, methods, DTOs and error bodies. The browser imports only contract types;
DTO dates remain ISO strings, independent of transport serialization.
