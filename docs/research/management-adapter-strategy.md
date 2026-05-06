# Management Adapter Strategy

This note records research for Management Adapters, optional Scalar API reference UI, future
Dashboard asset serving, and Docker distribution. It is research input for a PRD, not a
normative contract. Normative decisions live in `CONTEXT.md` and ADRs.

Status update: ADR-0005 replaces the custom `ManagementRequest`/`ManagementResponse`
adapter translation model with oRPC OpenAPI HTTP handlers. See
[`management-orpc-zod-stack.md`](./management-orpc-zod-stack.md) for the current adapter
research.

## Adapter Boundary

The Management Surface owns:

- Management Route Map;
- TypeBox schemas;
- DTOs;
- OpenAPI generation;
- handler/business delegation to public `Monque` methods.

Management Adapters own:

- framework request/response translation;
- extracting request context from framework-specific objects;
- mounting routes into a server;
- serving OpenAPI JSON from the Management Surface;
- optional API reference UI such as Scalar.

This matches ADR-0003 and ADR-0004.

## Express First

Findings:

- Express routers and middleware are a straightforward reference adapter target.
- A likely user-facing shape is mounting the adapter at a base path chosen by the host
  application.
- If mounted at `/monque`, Management Route Map endpoints live under `/monque/api/v1/*`.

Implications:

- Express should be the first Management Adapter because it gives the simplest embedded
  integration path and a readable reference for future adapters.
- Express-specific auth middleware remains in the host application; the adapter can pass
  request context into Management authorization and payload serialization hooks.

Sources:

- Express middleware guide: https://expressjs.com/en/guide/using-middleware.html

## OpenAPI JSON And Scalar

Findings:

- Scalar's Express package can render an API reference from an OpenAPI URL.
- Scalar supports passing a URL such as `/openapi.json`; this keeps the OpenAPI document
  cacheable and separately inspectable.
- Scalar is human-facing documentation UI, not the machine contract.

Implications:

- Management Adapters should serve OpenAPI JSON from the Management Surface.
- Scalar should be optional adapter-level functionality and disabled by default.
- `@monque/management` should not depend on Scalar.
- If an adapter exposes Scalar, it should use the OpenAPI URL produced by the adapter rather
  than generating a second spec.

Sources:

- Scalar Express integration: https://guides.scalar.com/scalar/scalar-api-references/integrations/express
- Scalar API reference configuration: https://scalar.com/products/api-references/configuration
- Scalar Express package: https://www.npmjs.com/package/@scalar/express-api-reference

## Dashboard Asset Serving

Findings:

- Express can serve static assets with `express.static`.
- Dashboard asset serving should not be part of the Management Surface.

Implications:

- `@monque/dashboard` should be a separate package containing built static assets and a
  generated OpenAPI/TanStack client.
- Management Adapters may later compose with the Dashboard package to serve assets, but this
  is not needed for the first Management Surface.
- A future Express dashboard adapter can serve static Dashboard assets and an SPA fallback
  while reusing the Management Route Map API endpoints.

Sources:

- Express static files guide: https://expressjs.com/en/starter/static-files.html

## Standalone Server And Docker

Findings:

- Agendash legacy support for standalone CLI and Docker shows standalone distribution can be
  useful for scheduler dashboards.
- Docker should wrap a real standalone server shape rather than the framework-neutral
  Management Surface.
- This repo is Bun-first, and Bun publishes official Docker guidance using `oven/bun`.

Implications:

- Docker is a future distribution step after the Management Surface, an adapter, and the
  Dashboard/server shape exist.
- Docker should be published separately from library packages so embedded users do not inherit
  runtime/server baggage.
- A future standalone package can expose a CLI/bin and be the target for a Docker image.

Sources:

- Bun Docker guide: https://bun.sh/docs/guides/ecosystem/docker
- npm package metadata docs: https://docs.npmjs.com/cli/v11/configuring-npm/package-json/
- Legacy Agendash repository: https://github.com/agenda/agendash

## Recommended Direction

- Keep `@monque/management` framework-neutral.
- Build `@monque/management-express` as the first adapter after core prerequisites and the
  Management Surface.
- Serve OpenAPI JSON through adapters.
- Keep Scalar optional and adapter-level.
- Defer Dashboard asset serving, standalone server, and Docker until after the Management
  Surface and at least one Management Adapter exist.
