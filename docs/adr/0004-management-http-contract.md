# ADR-0004: Management HTTP Contract

Superseded by [ADR-0005](./0005-orpc-management-route-map.md).

Use a versioned resource-action HTTP contract. Use TypeBox for shared validation
schemas and `openapi3-ts` for OpenAPI documentation. Adapters and clients consume
the contract. Use Core's cursor pagination and bulk selectors for operator actions.
