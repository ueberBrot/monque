# ADR-0003: Framework-Neutral Management Surface

## Status

Accepted

## Context

Monque needs operator endpoints for inspecting jobs and requesting manual actions such as
retry, cancellation, and deletion. Those endpoints must support Express, Ts.ED, NestJS,
and other server frameworks without making one framework the implicit default.

## Decision

Create `@monque/management` as the framework-neutral Management Surface. It owns route
metadata, request and response contracts, and delegation to the public `Monque` management
methods. It does not export Express, Connect, Ts.ED, NestJS, Fastify, or Fetch middleware.

Framework-specific packages are Management Adapters, for example
`@monque/management-express`, `@monque/management-tsed`, and
`@monque/management-nestjs`.

## Consequences

Initial setup requires an adapter package before the endpoints can be mounted in a real
server.

Third-party adapters can build on the same Management Surface without copying Monque
management behavior or endpoint contracts.
