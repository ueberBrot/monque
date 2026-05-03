# Management OpenAPI Stack

This note compares TypeScript schema and OpenAPI tooling for the Management Route Map.
It is research input for a PRD, not a normative contract. Normative decisions live in
`CONTEXT.md` and ADRs.

## Constraints

The Management Surface needs tooling that:

- is framework-neutral;
- does not make Express, NestJS, Ts.ED, Fastify, or Hono the source of truth;
- supports HTTP request validation and response DTO typing;
- can produce a first-class OpenAPI contract for Dashboard client generation;
- does not force future core job payload schemas to use one user-facing schema library.

## Recommended Stack

Use TypeBox for Management HTTP schemas and `openapi3-ts` for OpenAPI 3.1 document
assembly.

Why:

- TypeBox creates in-memory JSON Schema objects with TypeScript static type inference.
- TypeBox schemas can drive validation and OpenAPI schema emission without choosing Zod,
  ArkType, or Valibot for users.
- `openapi3-ts` provides typed OpenAPI 3.x models and builder helpers and supports separate
  OpenAPI 3.0 and 3.1 imports.
- The combination keeps `@monque/management` framework-neutral and lets the Management Route
  Map remain the source of truth.

Costs:

- Monque still needs small local helpers to connect route metadata, TypeBox schemas,
  validators, and `openapi3-ts` document generation.
- TypeBox is not the same as future core job payload schema support. Core payload schemas
  should remain a separate design and should prefer Standard Schema-style interoperability
  where possible.

Sources:

- TypeBox package/docs: https://www.npmjs.com/package/@sinclair/typebox
- TypeBox repository: https://github.com/sinclairzx81/typebox
- `openapi3-ts` package: https://npm.io/package/openapi3-ts

## Alternatives Considered

### ts-rest

Fit: good if Monque wants a third-party contract DSL to become the route map.

Pros:

- Contract-first REST model.
- OpenAPI generation support.
- Standard Schema direction is promising.

Cons:

- Introduces the ts-rest contract DSL as the Management Surface's public shape.
- OpenAPI generation requires schema transformers.
- It is a larger framework choice than Monque currently needs for a small, owned route map.

Sources:

- ts-rest OpenAPI docs: https://ts-rest.com/openapi
- ts-rest contract docs: https://ts-rest.com/contract/overview

### Zod-to-OpenAPI

Fit: good only if Monque chooses Zod for Management HTTP schemas.

Pros:

- Mature ecosystem.
- Zod is familiar to many TypeScript users.
- Zod 4 has native JSON Schema conversion.

Cons:

- Chooses Zod before Monque has a core schema story.
- Future core job payload schemas should not force users into Zod.
- Adds a library preference that is not needed for fixed Management HTTP inputs.

Sources:

- Zod docs: https://zod.dev/
- Zod JSON Schema docs: https://zod.dev/json-schema
- zod-to-openapi repository: https://github.com/asteasolutions/zod-to-openapi

### Hono OpenAPI / Hono RPC

Fit: not primary for Monque's Management Surface.

Pros:

- Useful when Hono is the chosen server framework.
- Hono RPC can provide strong server/client type sharing.

Cons:

- Makes Hono part of the contract shape.
- Monque needs Express first and later Ts.ED/NestJS adapters, so framework neutrality matters
  more than Hono-specific ergonomics.

Sources:

- Hono OpenAPI example: https://hono.dev/examples/hono-openapi
- Hono RPC docs: https://www.honojs.com/docs/guides/rpc

## Standard Schema Implication

Standard Schema is relevant for future core job payload validation, not for the first
Management HTTP schema implementation.

Findings:

- Standard Schema defines a common validation and type-inference interface for TypeScript
  validation libraries.
- It is designed by maintainers from Zod, Valibot, and ArkType ecosystems.
- It does not by itself guarantee OpenAPI/JSON Schema output.
- Standard JSON Schema is emerging to standardize JSON Schema representation, but Monque
  should not block the Management Surface on that maturity.

Sources:

- Standard Schema: https://standardschema.dev/schema
- Standard Schema project: https://standardschema.dev/
- Standard JSON Schema: https://standardschema.dev/json-schema
- ArkType integration notes: https://arktype.io/docs/integrations

## Recommended Direction

- Use TypeBox and `openapi3-ts` for `@monque/management` v1.
- Keep future core job payload schema validation separate from Management HTTP schemas.
- Revisit Standard Schema for core job definitions when Monque adds runtime payload
  validation.
