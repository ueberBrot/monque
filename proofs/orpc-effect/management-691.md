# Portable Management Effect adapter (#691)

Implemented on `feat/management-effect` from the clean integration base
`48c607ef2ba687d665510d175153223abb9555c8`. The package is named exactly
`@monque/management-effect`; `native-effect-integration` is only a branch name.

The adapter exports a portable request Effect and mountable HttpRouter layer.
Both transports use the shared native Management router and the same protected
surface assembly as Express. The host owns authentication, identity, application
services, scheduler, request scopes, runtime, listener and shared-resource order.
No Dashboard adapter modules were edited.

## Architecture passes

Both required passes used fresh exploration agents, codebase-design, GLOSSARY and
ADRs 0003–0007. No HTML was generated. All reasonable findings were implemented.

1. Keep body limiting, origin checks, private trust state and protocol encoders in
   the existing deep Management Surface module. Add native construction there;
   concentrate Context/Scope capture, combined abort signals, interruptibility
   and runner termination joining in one portable request module. Keep mount
   metadata with the adapter, and listener/shared resources with the host.
2. Test the exported route layer rather than only the handler: installed Effect
   expands `/ops/*` to include `/ops`, so duplicate explicit registration failed.
   Remove that duplicate. Respect effective Effect URL/headers during dispatch:
   `toWeb` preserves its original Web source and can ignore host middleware
   rewrites. Reconstruct the Web Request with the effective URL/headers while
   retaining body and cancellation. Both findings have public-seam regressions.

This improves locality without creating a second route map, native operation
implementation, application runtime or scheduler. ADR-0009 records the lifetime
and portability decision; the package README describes host composition and
native failure semantics.

## Final verification

| Check                                                                                                               | Result                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `vp run build`                                                                                                      | All 10 workspace build tasks passed, including docs and example                      |
| `vp run type-check`                                                                                                 | 16 tasks passed; strict workspace typed lint and docs checks                         |
| `vp test run --project @monque/management --project @monque/management-express --project @monque/management-effect` | 19 files, 348 tests passed                                                           |
| `vp run --filter @monque/management-effect test`                                                                    | Strict scoped checks, 3 portable request/route tests and 18 actual-host tests passed |
| Scoped Management/Express/Effect `check:exports`                                                                    | Built ESM/CJS exports, publint and packed strict declaration checks passed           |
| `vp run lint:effect`                                                                                                | Core, Management and Management Effect: zero diagnostics                             |
| `bun packages/management-effect/tests/consumer/verify.mts`                                                          | Isolated packed Node consumer passed declaration and runtime checks                  |
| Scoped formatting, typed lint and `git diff --check`                                                                | Passed                                                                               |

Actual-host tests use Bun only as a private TCP listener. RPC uses the real
`RPCLink` client; HTTP uses actual network requests. The complete-operation matrix
uses Docker Testcontainers `mongo:8` with `directConnection=true`, native scheduler
Effects and a poisoned Promise `getJob` facade. It covers every shared operation:
reads, single, selected and bulk mutations, priority/rescheduling and processing
controls. It observes service-backed per-name redaction, overlapping identities,
read-only/optional-facade capabilities, unsupported actions, validation, conflict,
not-found/internal failures, body limits, origins and OpenAPI discovery.

The retained lifecycle matrix crosses the shipped adapter for both transports:
success/denial/defects, request finalizers, identities after suspension, tracing
parentage, client abort, a held runner finalizer, active shutdown ordering and
listener startup failure. A portable request test separately verifies that host
context failures remain in the Effect error channel. Cancellation is not rollback;
admitted external I/O retains ADR-0007 semantics.

The consumer packs core, Management and Management Effect, installs their archives
outside the workspace, compiles strict NodeNext declarations and mounts routes
under Node. ESM and CommonJS exports load; Express, platform-bun and platform-node
cannot be resolved in that installation. Consumer temp files are removed.

Workspace package/test discovery and CI already use package globs. The package's
full test task includes actual TCP/MongoDB tests. Root Effect lint and consumer
verification now include this adapter; no YAML changes were necessary.

Initial validation corrected fixture DTO/status assumptions and a malformed
MongoDB URI. A workspace build exposed ambient `@types/bun` pollution of browser
fetch types; private tests now explicitly use `bun-types`, and the full build
passes. The separately locked proof dependencies were installed before rerunning
strict workspace checks. These are resolved validation issues, not blockers.

No push, PR creation, issue closure or PR watch was performed. The parent owns
integration PR #696 and final coordinated release validation (#695).
