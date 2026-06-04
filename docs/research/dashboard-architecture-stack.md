# Dashboard Architecture Stack

This note records research for the first bundled Monque Dashboard. It is research input for
a PRD and issue breakdown, not a normative contract. Normative decisions live in
`CONTEXT.md` and ADRs.

Research date: 2026-05-11.

## Context

The Dashboard should be a bundled React SPA that can be served by backend adapters. It
should inspect Queue Views and operate existing Jobs through the Management Route Map. It
should not mount the Management API, talk to MongoDB, expose a React component library, or
create a Dashboard-only API.

## Package Shape

Findings:

- Vite production builds include referenced assets in the build graph, generate hashed file
  names, and can produce split chunks.
- Express can serve static assets, but framework-specific SPA fallback and runtime config
  injection belong in a serving adapter, not in the Dashboard asset package.

Implications:

- `@monque/dashboard` should ship an HTML template, hashed assets, a manifest or asset
  metadata helper, and runtime config types.
- Serving adapters such as `@monque/dashboard-express` should inject `basePath` and
  `apiBaseUrl` into the HTML template, serve hashed assets with long cache headers, and serve
  HTML with no-cache headers.
- The same Dashboard build can be served under different mount paths without rebuilding.

Sources:

- Vite static asset handling: https://vite.dev/guide/assets.html
- Vite production build: https://vite.dev/guide/build
- Express static files: https://expressjs.com/en/starter/static-files.html

## Router And URL State

Findings:

- TanStack Router validates and types search params through route `validateSearch`.
- Search params can be read in loaders/components and written with router navigation APIs.
- TanStack Router supports route code splitting. With file-based routing and the Vite
  bundler plugin, automatic route code splitting can split non-critical route code.

Implications:

- Dashboard filters, pagination cursors, limits, and sort parameters should use TanStack
  Router search state.
- Row selection should remain local state because copied URLs must not carry bulk-action
  selections.
- The Dashboard should use TanStack Router with Vite plugin support and route-level code
  splitting.

Sources:

- TanStack Router search params: https://tanstack.com/router/latest/docs/framework/react/guide/search-params
- TanStack Router search validation: https://tanstack.com/router/latest/docs/how-to/validate-search-params
- TanStack Router code splitting: https://tanstack.com/router/latest/docs/framework/react/guide/code-splitting

## oRPC Client And TanStack Query

Findings:

- oRPC `OpenAPILink` lets a client call an OpenAPIHandler-compatible API through
  HTTP/Fetch from a contract router.
- `OpenAPILink` accepts a custom `fetch`, so Dashboard API calls can include browser
  credentials for host-owned cookie/session authentication.
- `@orpc/tanstack-query` provides `createTanstackQueryUtils(client)`, including
  `.queryOptions`, `.infiniteOptions`, `.mutationOptions`, and key helpers.
- oRPC client error handling supports typed error checks through `isDefinedError`.

Implications:

- `@monque/dashboard` should import the runtime Management contract from
  `@monque/management/contract`, create an oRPC `OpenAPILink`, and wrap it with
  `createTanstackQueryUtils`.
- Dashboard Job listing should use normal `.queryOptions` because cursor state is explicit
  and URL-backed; infinite-query behavior is not needed in v1.
- Mutation handlers should use oRPC keys/utilities for invalidation and typed oRPC errors
  for operator-facing error states.

Sources:

- oRPC OpenAPILink: https://orpc.dev/docs/openapi/client/openapi-link
- oRPC TanStack Query integration: https://orpc.dev/docs/integrations/tanstack-query
- oRPC client error handling: https://orpc.dev/docs/client/error-handling

## Mock Data And Dev Shell

Findings:

- oRPC's `implement` helper can create alternative router/procedure implementations for
  testing and frontend mock servers.
- Interface Forge provides Faker-backed, type-safe factories, optional Zod integration, and
  deterministic seeded generation.

Implications:

- `apps/dashboard-dev` should include mock mode first and live mode later.
- Mock mode should use an oRPC mock Management router built from the same Management
  contract, keeping the Dashboard client path production-like.
- Interface Forge can generate base DTO fixtures from Zod schemas, but Monque should still
  define scenario factories so Job states remain coherent.
- Faker and Interface Forge versions should be pinned closely enough to avoid visual test
  drift from generated fixture changes.

Sources:

- oRPC testing and mocking: https://orpc.dev/docs/advanced/testing-mocking
- Interface Forge npm package: https://www.npmjs.com/package/interface-forge

## Tables

Findings:

- TanStack Table supports manual server-side pagination by setting `manualPagination`.
- TanStack Table row selection state can be managed externally; with manual pagination,
  selected row models only reflect rows in the current page, while selection state can still
  contain IDs not present in the current data array.
- TanStack Table has first-class column visibility state.
- shadcn's data table guidance is intentionally a composition guide rather than a single
  universal component, because data tables have specific source, filtering, and sorting
  requirements.

Implications:

- Dashboard Jobs tables should use TanStack Table in manual server-side mode.
- The Dashboard should expose only server-backed filters and sorting, not client-side
  filtering/sorting over a single cursor page.
- Row selection should be controlled by Dashboard-local table/store state, with explicit
  selected rows only for v1 bulk actions.
- shadcn table primitives and shadcn-compatible registry pieces should be composed into
  feature components such as `JobsTable`; they should not hide the server-backed nature of
  the data.

Sources:

- TanStack Table pagination: https://tanstack.com/table/latest/docs/guide/pagination
- TanStack Table row selection: https://tanstack.com/table/latest/docs/guide/row-selection
- TanStack Table column visibility: https://tanstack.com/table/latest/docs/guide/column-visibility
- shadcn Data Table: https://ui.shadcn.com/docs/components/data-table

## Forms And Validation

Findings:

- TanStack Form supports Standard Schema validators directly.
- Current TanStack Form docs list Zod as a supported Standard Schema library; no separate
  Zod form adapter is needed.
- Standard Schema validation does not provide transformed values, so UI state still needs
  explicit serialization before API calls.

Implications:

- Use TanStack Form for non-trivial forms such as rescheduling and date-filter forms.
- Use Management contract schemas for API wire contracts and Dashboard-local Zod schemas for
  UI state such as date ranges and runtime config.
- Do not add `@tanstack/zod-form-adapter`.

Sources:

- TanStack Form basic concepts: https://tanstack.com/form/latest/docs/framework/react/guides/basic-concepts
- TanStack Form validation: https://tanstack.com/form/latest/docs/framework/react/guides/validation

## UI Component Policy

Findings:

- shadcn supports a registry model for distributing component source, hooks, pages, config,
  rules, and other files.
- shadcn-compatible registry components can be added as source and then adapted locally.
- The shadcn Data Table docs reinforce composition from primitives rather than opaque
  design-system runtime packages.

Implications:

- Dashboard reusable primitives should be shadcn-first, including compatible shadcn ecosystem
  registries when the source is small, readable, and dependency-light.
- Local feature components are still expected, but they should compose shadcn primitives
  around Monque domain concepts.
- JSON viewer and cron display components from shadcn-compatible registries are candidates,
  but their source should be reviewed before adoption.

Sources:

- shadcn registry: https://ui.shadcn.com/docs/registry
- shadcn registry index: https://ui.shadcn.com/docs/registry/registry-index

## Testing And Release Checks

Findings:

- Playwright supports screenshot capture and visual comparisons through
  `expect(page).toHaveScreenshot()`.
- Playwright warns that screenshots can vary by OS, browser, hardware, settings, and
  headless mode, so visual baselines need a stable execution environment.
- Playwright also publishes `@playwright/cli`, a command-line interface designed for coding
  agents that need token-efficient browser automation.

Implications:

- Dashboard releases should require Playwright smoke coverage for route loading, core
  workflows, error states, and responsive layout sanity.
- Visual tests should focus on representative states and run in a controlled environment.
- Core/Management tests should keep real MongoDB/Testcontainers coverage; Dashboard tests
  should use mock Management handlers.
- The Dashboard implementation plan should add `@playwright/cli` as repo-local agent tooling
  so agents can inspect frontend behavior during development. It should not be added to any
  published package runtime dependency set.

Sources:

- Playwright screenshots: https://playwright.dev/docs/screenshots
- Playwright visual comparisons: https://playwright.dev/docs/test-snapshots
- Playwright coding agents CLI: https://playwright.dev/docs/getting-started-cli

## Recommended Direction

1. Add additive Dashboard-grade listing support in `@monque/core`, including server-backed
   filters, whitelisted sorting, stable compound cursors, and practical index coverage.
2. Add `@monque/management/contract` and expose the new listing query shape in the
   Management Route Map and OpenAPI document.
3. Build `@monque/dashboard` as a Vite/TanStack Router React asset package using oRPC
   `OpenAPILink`, `@orpc/tanstack-query`, TanStack Table/Form/Store/Hotkeys, shadcn
   ecosystem components, Zod v4, and date-fns.
4. Build `apps/dashboard-dev` with oRPC mock handlers and seeded deterministic scenario
   factories.
5. Build `@monque/dashboard-express` as a UI-only serving adapter that injects runtime
   config and serves SPA fallbacks.
6. Add other serving adapters, standalone server, and Docker only after the asset package and
   Express serving path prove stable.
