# Coordinated oRPC migration #689

Implemented against integration `ce4cab605f79f6789d7ec28b97d49f90b018548e`
(#686 proof, #687 relocation, #688 native operations). The checkout started at
that commit and merging the integration tip reported already up to date.

All participating workspace oRPC contract, server, OpenAPI, Zod, client and
TanStack Query packages are pinned to `2.0.0-beta.45`. The workspace lockfile
contains one Effect resolution, `4.1.4`, and no remaining oRPC v1 packages.
Installed first-party exports, route metadata, generator/converter, Fetch,
Effect runner and TanStack implementation sources were checked before adoption.
The official Effect runner source matches the #686 proof's documented bridge.

One procedure implementation now uses official `.effect` handlers over #688's
native operations. `createNativeManagementRouter` carries required host services;
legacy `createManagementRouter` supplies an empty Effect context through one
ordinary oRPC middleware and preserves optional facades and boolean/Promise
hooks. There is no application Layer or ManagedRuntime per request. The existing
synchronous factories and public export names remain available.

OpenAPI remains the Dashboard connection. v2 imports, origin/path separation,
Fetch invocation, error-code status mapping and fixture decoding were migrated
together. Existing versioned HTTP metadata, coercion, DTOs, custom errors,
authentication, body limits and origin protections remain covered by the original
regressions. Stable reusable OpenAPI schema names and equivalent v1 schema
spellings are retained through a converter adapter. Normalization only changes
schema nodes, leaves examples/defaults untouched, and converts action unions
only after checking disjoint discriminator values. The Management README records
required changes for direct oRPC consumers; cross-major interoperability is not
promised. RPC mounting and the Dashboard RPC switch remain #690.

## Architecture passes

Both required passes used fresh exploration agents, codebase-design, GLOSSARY,
and relevant ADRs. Neither generated HTML.

1. Before implementation: keep one procedure map and shared native policy; adapt
   existing facades once, preserve synchronous factories, and keep HTTP protection
   in the existing surface module. Applied. Retained arbitrary-rejection tests
   unchanged; the official runner preserves their values. No duplicate native
   route map or Promise scheduler path was introduced.
2. After implementation: preserve optional handler arguments and host context
   identity, keep trust state private, narrow OpenAPI normalization, preserve
   base-URL search/hash, and document execution/lifetime obligations. Applied:
   the surface uses a private WeakMap, exposes the compatible optional handle
   arguments, and preserves the unmatched result shape. The README explains
   explicit request Scope/context/cancellation, runner termination joining,
   tracing limits and admitted-write cancellation limits.

## Verification

All final checks below passed on this checkout. Database/listener tests used
sandbox escalation, Docker Desktop and real MongoDB rather than reporting Docker
unavailable. Public request regressions established the initial red migration
failures before adapting the selected release.

| Command / working directory                        | Result                                                         |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `vp run build` / root                              | 9 tasks passed, including docs and relocated example           |
| `vp run type-check` / root                         | 15 tasks passed, including strict typed lint and docs          |
| `vp run check:exports` / root                      | 18 tasks passed; publint and packed ESM/CJS declaration checks |
| `vp run lint:effect` / root                        | Core and Management: zero diagnostics                          |
| `vp fmt --check`, `git diff --check` / root        | Passed                                                         |
| `vp test run` / packages/core                      | 73 files, 1,094 tests passed with Testcontainers               |
| `vp test run` / packages/management                | 16 files, 304 tests passed                                     |
| `vp test run` / packages/dashboard                 | 15 files, 117 tests passed                                     |
| `vp test run` / packages/management-express        | 25 tests passed                                                |
| `vp test run` / packages/dashboard-express         | 25 tests passed                                                |
| `vp test run` / packages/tsed                      | 19 files, 131 tests passed                                     |
| `vp test run` / apps/dashboard-dev                 | 13 files, 120 tests passed                                     |
| `vp test run` / examples/effect-host               | 19 tests passed with real MongoDB                              |
| `bun test proofs/orpc-effect/proof.test.ts` / root | 14 compatibility gate tests passed                             |
| Playwright feature/priority workflows              | 62 tests passed, desktop and authenticated desktop             |

The native router request tests exercise the real scheduler Effect interface,
service-backed authorization once per operation, host-owned request finalizers,
HTTP-abort runner cleanup, and isolated concurrent per-Job-Name payload redaction.
Existing regressions retain arbitrary throws/rejections, live optional facades,
OpenAPI discovery, read-only capability policy, DTO/status/error behavior and
TanStack cache behavior. Built Dashboard assets contain no native router,
MongoClient, effect/context or runPromiseExitWith implementation markers.

For browser reproduction, start `MongoDBContainer("mongo:8")`, append
`directConnection=true` to its mapped connection string, and supply it as
`MONQUE_DASHBOARD_TEST_MONGO_URI`. Stop the container in `finally`. From
`apps/dashboard-dev`, run:

```sh
bun x --no-install playwright test \
  --project=mongo-desktop --project=mongo-desktop-auth \
  tests/real-db/features.spec.ts tests/real-db/priorities.spec.ts \
  --reporter=line
```

The initial core run had one clock-window failure in the existing renewable
server-time assertion. Its isolated ten-test suite and the subsequent complete
1,094-test run both passed; no core source or tests were changed. Browser setup
attempts initially used the inactive default URI, then omitted directConnection
for the Docker replica-set hostname. Correcting the invocation produced the
62-test pass. No verification blockers remain. Other browser projects and the
future Effect-host RPC matrix were not claimed as executed by this ticket.

No push, publication, PR creation, issue closure or PR watch was performed.
