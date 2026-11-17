# Dashboard RPC and public HTTP (#690)

Implemented from integration `07059bbd7ad93f723bbaaf187431d816cd25ac9d`.
The clean checkout started at that commit. Merging `feat/native-effect-integration`
before completion reported already up to date at the same SHA.

The Management Surface creates one shared router and mounts official Fetch RPC and
OpenAPI handlers. The Express adapter mounts RPC at `/rpc` beneath its Management
mount. Public `/api/v1` paths, methods, DTOs, statuses, OpenAPI discovery and custom
`{ error }` bodies remain intact. RPC uses its native serializer and error envelope.
Both handlers share request preparation, origin checks, body limiting and the same
operation authorization, context, capabilities, read-only and serialization policy.
GET is not admitted on the RPC handler, including for mutation procedures.

The bundled Dashboard now uses RPCLink and a type-only browser contract import.
TanStack Query integration, keys, pagination, polling, mutations and invalidation
remain in place. Runtime `apiBaseUrl` identifies the Management mount; `/rpc` is
appended without losing base query parameters. DTO dates remain ISO strings.
Host authentication can still reject before RPC, including custom JSON error bodies
and malformed JSON with an authentication status; client feedback preserves status.

Development mock and database handlers serve both protocols. Dev runtime config
uses `/api`, Connect preserves the real incoming host for same-origin POST checks,
and the live proxy rewrites only `/api/rpc` beneath the upstream Management mount.
Public `/api/v1` proxy paths remain intact. Browser request observers and unit wire
fixtures now use native RPC procedure paths, inputs and envelopes. Public HTTP
regressions remain HTTP requests. ADRs 0005/0006, GLOSSARY, package/user docs and
pending release notes describe the final dual transport behavior.

## Architecture passes

Both passes used fresh exploration agents, codebase-design, GLOSSARY and relevant
ADRs. No HTML was generated for either pass.

1. Before implementation: keep policy in the deep Management Surface module;
   construct one router, separate protocol encoders, use a distinct RPC submount,
   coordinate dev mounts and keep the browser contract type-only. Applied. The
   deletion test shows that removing this module would redistribute request
   protection across adapters; no new public abstraction was needed.
2. After implementation: consolidate duplicate trust/context request preparation,
   preserve official handler instances and optional handle arguments, preserve real
   dev Host for origin checks, remove invalid inner status fields from RPC error
   fixtures, retain authentication status for malformed host JSON, and document
   live-proxy origin trust. Applied. Actual browser tests established the dev Host
   failure; actual client tests established that the official Fetch decoder alone
   loses status when JSON parsing fails, so the client handles that host error
   before decoding RPC. A real live-proxy regression also established and corrected
   public HTTP path rewriting. These changes improve locality at existing seams.

## Verification

Pinned installed dependency sources were inspected; the permitted Router/Query
composition skill was loaded. No Effect implementation was changed. Effect lint
still passed for the affected Management build. Tests exercise public request,
actual RPC client, Express adapter and browser seams authorized by the spec.

| Check                                      | Result                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Workspace build                            | 9 tasks passed, including docs and example                                         |
| Workspace type-check and strict typed lint | 15 tasks passed                                                                    |
| Packed exports/declarations                | 18 tasks passed                                                                    |
| Effect lint                                | Core and Management: zero diagnostics                                              |
| Management                                 | 17 files, 315 tests passed                                                         |
| Dashboard                                  | 15 files, 119 tests passed                                                         |
| Management Express                         | 30 tests passed                                                                    |
| Dashboard Express                          | 25 tests passed                                                                    |
| Dashboard development                      | 14 files, 121 tests passed                                                         |
| Existing Effect example                    | 19 tests passed with real MongoDB                                                  |
| Express browser matrix                     | 424 tests passed: desktop, mobile and both authenticated projects                  |
| Shared-browser smoke                       | Custom independent mounts; observed actual RPC health/capability POSTs and polling |
| Formatting and diff whitespace             | Passed                                                                             |

The browser matrix used disposable `MongoDBContainer("mongo:8")` instances through
Docker Desktop, with `directConnection=true` on the mapped URI. Containers were
stopped in `finally`. The real Vite live proxy test covers RPC and public HTTP at
a custom upstream mount. The browser matrix includes authenticated deep links,
read-only/denied operations, permitted mutations, paging, polling, races, cache
refresh, permissions, errors, dates and development database mode.

Early verification attempts hit sandbox restrictions on dependency caches/listeners,
an incorrectly assembled MongoDB URI, and concurrent build cleanup of browser
assets. Authorized escalation, the corrected URI and stable built assets resolved
those invocation issues. Required final checks passed. Core and Ts.ED runtime suites
were not rerun because their implementations were unchanged; their builds and export
checks passed. No verification blockers remain.

No push, publication, PR creation, issue closure or PR watch was performed.
