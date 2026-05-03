# ADR-0004: Management HTTP Contract

## Status

Accepted

## Context

The Management Surface needs a stable HTTP contract before the Dashboard exists so
framework adapters and future clients share the same routes, validation behavior, and
error semantics.

## Decision

Use a versioned `/api/v1` Management Route Map with resource-action routes. Job listing
uses cursor pagination only and exposes the public core cursor filters. Bulk job actions
use the public core selector shape.

`@monque/management` exports an OpenAPI specification derived from the Management Route
Map. Adapters may serve that specification, but they do not generate or redefine it.

Management HTTP request and response schemas use TypeBox, and OpenAPI document generation
uses `openapi3-ts`. This keeps the Management Surface framework-neutral while allowing the
future Dashboard to generate TanStack Query clients from OpenAPI.

Map invalid request shape to `400`, missing jobs to `404`, invalid job state transitions
to `409`, read-only mutation attempts to `403`, and unexpected core or connection errors
to `500`.

## Consequences

Adapters translate framework requests into the same Management Route Map instead of
inventing routes per framework.

Future Dashboard code can depend on the Management Route Map without binding to a specific
server framework. The Dashboard can generate TanStack Query clients from the OpenAPI
contract without importing runtime code from `@monque/management`.
