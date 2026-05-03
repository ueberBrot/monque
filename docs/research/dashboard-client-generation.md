# Dashboard Client Generation

This note compares OpenAPI-to-TypeScript client generation options for a future React
Dashboard using TanStack Query. It is research input for a PRD, not a normative contract.
Normative decisions live in `CONTEXT.md` and ADRs.

## Context

The Dashboard should not import runtime code from `@monque/management` for API calls.
Instead, the Management Surface should export OpenAPI, and the Dashboard should generate a
typed client from that contract.

This keeps the Management Surface, Management Adapters, and Dashboard decoupled while still
providing type-safe data fetching.

## Hey API

Findings:

- `@hey-api/openapi-ts` supports generating TypeScript clients from OpenAPI.
- It supports TanStack Query through plugins including `@tanstack/react-query`.
- It can generate query keys, query options, infinite query options, and mutation options.
- Fetch is a first-class client option.
- It can run from CLI, programmatic API, or Vite plugin.
- Generated output should be treated as disposable generated code.
- Current docs indicate Node.js 22+ support, which aligns with this repo's Node baseline.

Strengths for Monque:

- Good fit for TanStack Query v5-style `queryOptions` and `mutationOptions`.
- Keeps generated client composition in the Dashboard code instead of generating opaque
  hooks only.
- Plugin ecosystem can also emit schemas such as Zod if the Dashboard later needs them.

Risks:

- Requires choosing a generated output convention and keeping it out of hand-edited code.
- As with any generator, upgrades can cause generated code churn.

Sources:

- Hey API site: https://heyapi.dev/
- Hey API GitHub: https://github.com/hey-api/openapi-ts
- Hey API TanStack Query docs: https://www.mintlify.com/hey-api/openapi-ts/state-management/tanstack-query

## Orval

Findings:

- Orval supports generating type-safe React Query hooks from OpenAPI.
- It can generate one custom hook per OpenAPI operation.
- It supports query key helpers, infinite queries, prefetching, invalidation helpers,
  `setQueryData`, and `getQueryData`.
- It can use Fetch or Axios and supports custom clients through mutators.
- It has strong monorepo ergonomics through named projects, split/tag-split output, CLI
  targeting, watch mode, cleaning, and formatter options.

Strengths for Monque:

- Good fit if the Dashboard wants ready-to-use generated hooks.
- Rich cache helper generation can reduce application-side wrapper code.
- Mature OpenAPI-driven React Query workflow.

Risks:

- Some public examples still show older React Query call shapes in snippets. Before choosing
  Orval, verify generated output against the exact installed version and TanStack Query v5.

Sources:

- Orval React Query guide: https://orval.dev/docs/guides/react-query
- Orval configuration docs: https://orval.dev/docs/reference/configuration/
- Orval CLI docs: https://orval.dev/docs/reference/cli/

## TanStack Query

Findings:

- TanStack Query is the target Dashboard server-state library.
- Polling is enough for the first Dashboard; no SSE or WebSocket protocol is needed in v1.
- Generated clients should expose stable query keys and mutation helpers so the Dashboard can
  invalidate job lists, queue summaries, stats, and job details after mutations.

Sources:

- TanStack Query: https://tanstack.com/query/
- TanStack React Query docs: https://tanstack.com/query/latest/docs/react/

## Recommended Direction

Use the OpenAPI contract from `@monque/management` as the Dashboard client source.

Prefer Hey API if the Dashboard wants TanStack Query v5-native options and explicit app-side
composition.

Prefer Orval if the Dashboard wants generated React hooks and cache helpers with less wrapper
code.

Do not choose the final generator in the Management Surface PRD unless needed. The important
Management Surface requirement is that the OpenAPI document is complete, stable, and codegen
friendly.
