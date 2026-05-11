# ADR-0006: Dashboard Asset Package And Serving Adapters

## Status

Accepted

## Context

Monque needs a bundled React Dashboard that can be served from host backends while keeping
the Management Surface framework-neutral. The Dashboard should use the same Management Route
Map as other clients and should not create a Dashboard-only API.

## Decision

`@monque/dashboard` is an asset/UI-only package. It ships a built React SPA, an HTML
template, hashed assets, asset metadata helpers, and runtime config types. It does not mount
HTTP routes, expose a React component library, depend on `@monque/core`, or talk directly to
MongoDB.

Dashboard serving is handled by framework-specific serving adapters such as
`@monque/dashboard-express`. These adapters serve Dashboard assets and SPA fallbacks only;
they do not mount the Management API. Host applications compose Dashboard serving adapters
with Management Adapters, authentication middleware, and authorization hooks.

Serving adapters inject mount-aware runtime configuration, including the Dashboard base path
and Management API base URL, into the Dashboard HTML template. The Dashboard imports the
browser-safe `@monque/management/contract` subpath for oRPC end-to-end typing and calls the
mounted Management Route Map through the oRPC OpenAPI client.

## Consequences

The same Dashboard build can be served at different mount paths without rebuilding. Future
framework adapters, standalone servers, and Docker images wrap the same asset package instead
of changing the Dashboard runtime boundary. Management API routing remains owned by
Management Adapters, and Dashboard serving remains a separate composition concern.
