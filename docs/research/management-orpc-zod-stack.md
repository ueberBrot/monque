# Management oRPC And Zod Stack

This note records research for replacing the current Management Surface implementation with
oRPC and Zod v4. It is research input for ADR-0005 and PR #429, not a normative contract.
Normative decisions live in `CONTEXT.md` and ADRs.

## Constraints

The Management Surface still needs to:

- stay framework-neutral;
- expose one REST-shaped `/api/v1` Management Route Map;
- generate OpenAPI from the same contract used by handlers;
- allow a first-party typed TypeScript Dashboard client;
- keep OpenAPI as the stable third-party interoperability contract;
- keep adapters thin and framework-specific;
- call public `Monque` methods rather than direct MongoDB APIs;
- support request-context-aware authorization and payload serialization.

## Recommended Stack

Use oRPC and Zod v4 for the Management Surface rewrite.

Package direction for `@monque/management`:

- keep `@monque/core` and `mongodb` as peer dependencies;
- add oRPC server/OpenAPI packages;
- add Zod v4;
- add `@orpc/zod` for the Zod v4 JSON Schema converter;
- remove TypeBox and `openapi3-ts`;
- do not add oRPC client runtime to the server package.

Why:

- oRPC can define HTTP method/path metadata on procedures with `.route(...)`.
- oRPC `OpenAPIHandler` serves REST/OpenAPI-compatible routes.
- oRPC `OpenAPIGenerator` can generate OpenAPI from a router or contract.
- oRPC has a built-in Zod v4 JSON Schema converter.
- oRPC client packages can be used by Dashboard/client packages without making
  `@monque/management` ship client runtime.

Sources:

- oRPC OpenAPI getting started: https://orpc.dev/docs/openapi/getting-started
- oRPC OpenAPI handler: https://orpc.dev/docs/openapi/openapi-handler
- oRPC OpenAPI specification generation: https://orpc.dev/docs/openapi/openapi-specification
- oRPC OpenAPI client link: https://orpc.dev/docs/openapi/client/openapi-link

## Management Route Map Shape

The oRPC router should become the Management Route Map implementation.

Implications:

- Every public procedure should declare explicit REST-shaped route metadata.
- The Dashboard should use the same `/api/v1` routes as third-party HTTP clients.
- Do not keep a separate `MANAGEMENT_ROUTE_MAP` beside the oRPC router.
- Do not keep a separate RPC-shaped Dashboard API.
- Keep operation IDs stable because generated OpenAPI clients depend on them.

Example shape:

```typescript
os.route({
	method: 'GET',
	path: '/api/v1/jobs/{id}',
	operationId: 'getJob',
});
```

Relevant oRPC findings:

- OpenAPI routing can override default RPC-ish route generation with explicit `method` and
  `path`.
- Route prefixes can apply to procedures that define paths.
- Path parameters merge into input by default, or can be separated through detailed input
  structure.

Sources:

- oRPC OpenAPI routing: https://orpc.dev/docs/openapi/routing
- oRPC OpenAPI input/output structure: https://orpc.dev/docs/openapi/input-output-structure

## Zod v4 Schemas

Zod schemas should be the source of truth for Management HTTP DTOs.

Implications:

- Export named schemas such as `JobDtoSchema`, `JobSelectorDtoSchema`, and
  `ManagementErrorDtoSchema`.
- Export DTO types with `z.infer<typeof Schema>`.
- Map core/domain values to DTOs explicitly at the Management Surface boundary.
- Keep core `JobSelector` separate from the HTTP `JobSelectorDto` because HTTP dates are
  strings and core dates are `Date` values.

Why Zod v4 over ArkType:

- oRPC lists built-in Zod converter support for Zod v4.
- ArkType OpenAPI conversion is exposed through an `experimental_` converter.
- Contract stability matters more than schema syntax for the Management Surface.

Sources:

- oRPC OpenAPI schema converters: https://orpc.dev/docs/openapi/openapi-specification
- Zod: https://zod.dev/
- ArkType: https://arktype.io/

## Request Input Structure

Use explicit schemas for each operation input. Prefer simple compact inputs where it keeps
the handler readable, and detailed input structure when separating `params`, `query`,
`headers`, and `body` prevents ambiguity.

Important constraints:

- Job detail/action endpoints need path `id`.
- Job listing needs query `cursor`, `limit`, `name`, and repeated `status`.
- Bulk mutation endpoints need JSON body selector DTOs.
- Reschedule needs a JSON body with `nextRunAt` as an ISO string.

Repeated query arrays:

- oRPC OpenAPIHandler/OpenAPILink use bracket notation for query/form structures.
- Same-name query parameters are represented as arrays, so
  `?status=pending&status=failed` maps to `{ status: ['pending', 'failed'] }`.
- Empty arrays cannot be represented in bracket notation.

This matches the existing Management rule that query arrays use repeated parameters.

Sources:

- oRPC input/output structure: https://orpc.dev/docs/openapi/input-output-structure
- oRPC bracket notation: https://orpc.dev/docs/openapi/bracket-notation

## Response And Error Shape

Successful responses should remain JSON DTOs.

For errors, oRPC maps common error codes to expected HTTP statuses, including `400`,
`403`, `404`, `409`, and `500`. That aligns with the Management HTTP status rules.

Open question for implementation:

- Existing Management responses use `{ error: string }`.
- oRPC's default error body is not the same shape.
- If Monque wants to preserve `{ error: string }`, configure `OpenAPIHandler` with a custom
  error response body encoder and configure `OpenAPIGenerator` with the matching custom
  error response body schema.

Recommended direction:

- Keep Management error DTO as `{ error: string }` for now.
- Wrap Management failures as `ORPCError` with the correct HTTP status and message.
- Add OpenAPI tests that assert generated error responses still use `ManagementError`.

Sources:

- oRPC OpenAPI error handling: https://orpc.dev/docs/openapi/error-handling
- oRPC custom error response format: https://orpc.dev/docs/openapi/advanced/customizing-error-response

## OpenAPI Generation

Generate OpenAPI from the oRPC router, not from a static JSON file or hand-maintained
builder.

Implications:

- `getManagementOpenApiDocument()` should call `OpenAPIGenerator`.
- Use `ZodToJsonSchemaConverter` from the Zod v4 oRPC package path.
- The generated document should include all v1 routes regardless of mounted scheduler
  capabilities.
- Adapter-specific server URLs and API reference paths should be adapter options.

Useful oRPC features:

- OpenAPI can be generated from a router or contract.
- Common schemas can be registered so reusable DTO names appear in `components.schemas`.
- Operation metadata such as `operationId`, summaries, descriptions, and tags can be
  attached through route metadata.
- `description` and `examples` metadata from Zod v4 are supported.

Sources:

- oRPC OpenAPI specification generation: https://orpc.dev/docs/openapi/openapi-specification

## Adapter Strategy

Management Adapters should mount oRPC handlers.

For Express:

- Create an oRPC `OpenAPIHandler` from the Management router.
- Mount it in Express using the oRPC Express/Node handler pattern.
- Pass context from an adapter-level context factory.
- Register body-parsing middleware after the oRPC middleware or only on non-oRPC routes,
  because Express body parser can interfere with oRPC's parsing behavior.

This replaces:

- translating framework requests into `ManagementRequest`;
- translating `ManagementResponse` back to framework responses;
- public adapter utilities for query parsing.

Sources:

- oRPC Express adapter: https://orpc.dev/docs/adapters/express
- oRPC OpenAPI handler: https://orpc.dev/docs/openapi/openapi-handler

## Client Strategy

`@monque/management` should stay server-only, but it should export type-level router/contract
information that client packages can use.

Dashboard/client packages can choose:

- oRPC `OpenAPILink` with an oRPC typed client for first-party TypeScript DX;
- generated OpenAPI clients for broader interoperability;
- direct HTTP calls against the same `/api/v1` routes.

Important oRPC finding:

- `OpenAPILink` communicates with `OpenAPIHandler` or any API following OpenAPI over
  HTTP/Fetch.
- Client runtime belongs in Dashboard/client packages, not `@monque/management`.

Sources:

- oRPC OpenAPI client link: https://orpc.dev/docs/openapi/client/openapi-link

## Prior Art

Bull Board uses a package split similar to the Monque direction:

- a base API package;
- UI package;
- framework adapters such as Express and NestJS integrations.

That supports the Management Surface + Management Adapter package split. The difference is
that Monque is making OpenAPI a first-class interoperability contract rather than treating
the dashboard API as internal UI plumbing.

Queuedash also shows demand for embedded dashboard integrations across frameworks such as
Express and Fastify, but it does not change the Monque conclusion: the Management Surface
should own behavior and the adapters should mount framework-specific handlers.

Sources:

- Bull Board Express package: https://www.npmjs.com/package/@bull-board/express
- Bull Board package metadata: https://app.unpkg.com/@bull-board/express@6.20.3/files/package.json
- Queuedash repository: https://github.com/alexbudure/queuedash

## Migration Plan Input

Use a single PR for the unreleased `@monque/management` rewrite, implemented in vertical
slices:

1. Replace dependencies and package exports.
2. Add Zod DTO schemas and inferred DTO types.
3. Add mapper modules from core objects to DTOs.
4. Add oRPC router factory bound to `ManagementOptions`.
5. Port health and capabilities.
6. Port queue views and stats.
7. Port list/get jobs.
8. Port single-job actions.
9. Port bulk actions.
10. Add OpenAPI generation and parity tests.
11. Delete old TypeBox, `openapi3-ts`, custom route map, validation, and request/response
    abstraction modules.

Testing focus:

- behavior through oRPC handler or callable procedures;
- generated OpenAPI route/path/schema/status coverage;
- capabilities with read-only mode, unsupported actions, and per-request authorization;
- repeated query arrays;
- error mapping and error body shape;
- payload serialization with request context.

## Risks And Follow-Ups

- Preserve `{ error: string }` intentionally or accept oRPC's default error format; do not
  drift accidentally.
- Verify exact oRPC package import paths while implementing because docs distinguish
  server, openapi, openapi-client, and zod packages.
- Decide whether output validation stays enabled. oRPC supports disabling output validation,
  but Monque should keep it enabled until performance says otherwise.
- Keep OpenAPI stable per package version; do not generate capability-specific OpenAPI.
- Keep the future core job payload schema decision separate from Management HTTP Zod schemas.

## Recommended Direction

- Implement ADR-0005 in PR #429.
- Keep `@monque/management` server-only.
- Use oRPC router as the Management Route Map.
- Use Zod v4 for Management DTO schemas and inferred DTO types.
- Generate OpenAPI from the router with the Zod v4 converter.
- Let Management Adapters mount the oRPC OpenAPI HTTP handler.
- Let Dashboard/client packages install oRPC client runtime if they want the typed client.
