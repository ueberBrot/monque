# ADR-0009: Portable Management Effect Adapter

Use portable Effect HTTP adapters so Effect hosts can serve Management without
Express. Shared Management operations and policy run through `@orpc/effect`;
Express retains its synchronous/Promise compatibility boundary. Hosts own
identity, services and resource lifetimes, with request scopes kept open until
oRPC's separate execution fibers finish.
