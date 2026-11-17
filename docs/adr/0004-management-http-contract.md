# ADR-0004: Management HTTP Contract

Superseded by [ADR-0005](./0005-orpc-management-route-map.md).

Choose a versioned resource-action HTTP contract, using TypeBox schemas and
`openapi3-ts` to establish shared routes and validation before building the
Dashboard. Adapters and clients consume that contract rather than define their
own. Reuse Core's cursor pagination and bulk selectors to keep operator actions
consistent with the scheduler.
