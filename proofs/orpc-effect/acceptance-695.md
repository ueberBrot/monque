# Final acceptance and release audit (#685 / #695)

Audited 2026-11-17 from integration `14f2a422aa3cadeed1075a475816412f61617677`.
The starting checkout matched that commit; fetching/merging
`origin/feat/native-effect-integration` reported already up to date. The source
of requirements is GitHub #685 and #686–695 (the supplied `/tmp/monque-spec-685`
JSON snapshots); criterion IDs below follow each ticket's checkbox order.
“Implemented” means present in final code with the cited executable regression,
not a claim that all historical intermediate migration states still exist.
The independent parent code review and its corrective verification are recorded below.
TDD used the already authorized public request/browser/process seams; dependency
skills were inventoried, the Router/Query composition skill loaded, and installed
Effect AGENTS, TestClock/resources examples and module sources consulted.

## Evidence index

Paths below are relative to the repository root. These are final implementations
and executable assertions, rather than earlier agents' completion summaries.

| Key | Implementation and regression evidence                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P   | `proofs/orpc-effect/{host.ts,proof.test.ts,package.json,bun.lock,README.md,evidence.txt}`: independently pinned real RPC/HTTP gate, native processing operation, identities after suspension, abort/join/finalizers, tracing and shutdown/startup failure.                                                                                                                                   |
| O   | `packages/management/src/{native.ts,compatibility.ts,orpc/operations.ts,surface/action-policy.ts,mappers/}`; `tests/unit/{native-operations,native-router,orpc-effect-compatibility,orpc-capabilities,orpc-payload-serialization}.test.ts`: shared native behavior, poisoned Promise facade, optional methods, rejected/thrown authorization, service-backed redaction.                      |
| T   | `packages/management/src/{orpc/router.ts,orpc/openapi.ts,surface/surface.ts,surface/body-limit.ts,surface/csrf.ts}`; `tests/unit/{rpc,orpc-openapi,orpc-openapi-generation,orpc-body-limit,orpc-csrf,orpc-processing,orpc-bulk-actions,orpc-single-job-actions,orpc-priority-action}.test.ts`: complete operation map, protocol encoding, protections, legacy DTO/status/schema regressions. |
| M   | `packages/management-effect/src/index.ts`; `tests/routes.test.ts`, `tests/bun/{operations,lifecycle}.test.ts`: both real network transports, real MongoDB/native scheduler, scoped runner termination, host URL/headers, identity and spans.                                                                                                                                                 |
| D   | `packages/dashboard/src/{serving.ts,runtime-config.ts,management-client.ts}` and `packages/dashboard-{express,effect}/src/`; adapter request suites and `dashboard-effect/tests/integration/browser.test.ts`: same assets, independent mounts, GET/HEAD, escaping/traversal/symlink checks, cache/fallback and RPC through Express Management.                                               |
| H   | `examples/effect-host/src/{main,host,options,tracing}.ts`, README and `tests/host.test.ts`: actual Bun processes, captured Worker service writes a receipt, auth on HTML/assets/discovery/both transports, roles/read-only, signals, active requests, startup failure and owned/borrowed telemetry order.                                                                                    |
| B   | `apps/dashboard-dev/{playwright.config.ts,tests/hosts/fixture.ts,tests/hosts/workflows.spec.ts,tests/real-db/}`: six projects, actual serving adapters, identity/failing-hook/read-only checks, deep links, mutations, pagination and external polling; existing query/cache unit tests remain.                                                                                              |
| W   | Root/package manifests, Vite task configs, `.github/workflows/ci.yml`, `scripts/ci/tests/`, all workspace tests, `scripts/verification/{pack-release,consumer,consumer-app}.mts` and both native packed consumers: projected release archives, isolated dependencies, public imports/declarations, four MongoDB scenarios and RPC/HTTP.                                                      |
| R   | All `.changeset/*.md`, `.changeset/config.json`, package peer ranges, Management README compatibility table, ADRs 0003/0005/0006/0007/0009 and GLOSSARY. Release reconciliation below.                                                                                                                                                                                                       |

## Ticket criteria

Every checkbox is represented individually. Source labels identify which final
implementation and executable assertions were inspected and run.

| Criterion | Requirement                                                                                                                                      | Status / evidence     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| #686.1    | Isolate the proof so it does not upgrade shipped packages or disturb the current worktree behavior                                               | Implemented — P       |
| #686.2    | Use actual RPC client calls and HTTP requests with the existing HTTP response shape                                                              | Implemented — P       |
| #686.3    | Prove concurrent identity isolation, request interruption, finalizers, tracing parentage, and shutdown while a request is active. Verify lifec…  | Implemented — P       |
| #686.4    | Record exact versions, execution/scope bridging, observed guarantees, and limits for external writes. Do not assume Effect context provision i…  | Implemented — P       |
| #686.5    | If a required guarantee fails, document the failure and keep dependent migration blocked                                                         | Implemented — P       |
| #687.1    | Move implementation, configuration, tests, and README together while retaining its private workspace package identity and keeping one maintain…  | Implemented — H, W    |
| #687.2    | Update workspace discovery, build/test filters, task dependencies, relative configuration references, CI, and documentation links                | Implemented — H, W    |
| #687.3    | Verify clean installation, dependency builds, documented startup, and current tests from the relocated location                                  | Implemented — H, W    |
| #687.4    | Do not require the oRPC migration or native adapter work for this mechanical relocation                                                          | Implemented — H, W    |
| #688.1    | Add the native operation/dependency form alongside supported synchronous and Promise facades, preserving existing public imports, hooks, HTTP …  | Implemented — O       |
| #688.2    | Share authorization policy, payload mapping/redaction, domain error classification, and operations rather than duplicating behavior for Effect   | Implemented — O       |
| #688.3    | Existing host authentication plus adapter-supplied context and boolean/Promise authorization callbacks still work, including denied, rejected,…  | Implemented — O, T    |
| #688.4    | Native authorization and serializers may require host Effect services                                                                            | Implemented — O, M    |
| #688.5    | Prove compatibility through the existing public request seam and native operation consumers                                                      | Implemented — O, M    |
| #688.6    | Keep the expand stage green                                                                                                                      | Implemented — O, W    |
| #689.1    | Upgrade all participating server, contract, OpenAPI, Dashboard, development-app, and TanStack Query packages together                            | Implemented — T, D, W |
| #689.2    | Adopt the verified Effect execution bridge using shared native operations while preserving existing public synchronous/Promise APIs and legacy…  | Implemented — O, P    |
| #689.3    | Preserve versioned paths, coercion, DTOs, status codes, custom public HTTP error bodies, OpenAPI discovery, and host authorization behavior      | Implemented — T       |
| #689.4    | Verify routing metadata, middleware execution count, plugins, imports, serialization, and client decoding against the selected release           | Implemented — T, P    |
| #689.5    | Keep builds, applicable tests, and package exports green across every affected package                                                           | Implemented — W, R    |
| #689.6    | Use the proof result from the parent gate                                                                                                        | Implemented — P, W    |
| #690.1    | Mount official RPC and OpenAPI handlers from one shared contract/router, with a distinct RPC submount beneath the configured Management mount    | Implemented — T       |
| #690.2    | Switch the Dashboard to RPCLink and retain TanStack Query integration, pagination, polling, mutations, and cache invalidation                    | Implemented — D, B    |
| #690.3    | Preserve runtime mount configuration and existing adapter options where possible                                                                 | Implemented — D, R    |
| #690.4    | Host authentication and the adapter-supplied authorization/context hook apply to both transports. Verify allowed, denied, throwing/rejected au…  | Implemented — T, B    |
| #690.5    | Enforce origin checks, body limits, redaction, and validation on RPC without applying the public HTTP error envelope to the RPC protocol         | Implemented — T       |
| #690.6    | Update dashboard-dev mock/database handlers, middleware, live proxy, and existing unit/browser fixtures for RPC so existing workflows remain f…  | Implemented — B       |
| #690.7    | Validate with actual RPC client and existing HTTP requests plus an Express Dashboard browser smoke test                                          | Implemented — B, R    |
| #691.1    | Ship the portable Management Effect adapter as mountable routes/layers using the shared router, native operations, and verified execution bridge | Implemented — M       |
| #691.2    | The host supplies its Monque instance, identity, services, authentication, and Effect-native authorization/context/serialization hooks           | Implemented — M, H    |
| #691.3    | Keep authorization behavior equivalent to Express for both transports, including action inputs, unsupported operations, capability reporting, …  | Implemented — M, O    |
| #691.4    | Test complete read, single/bulk mutation, and processing-control behavior through actual RPC and HTTP requests, including errors, limits, orig…  | Implemented — M       |
| #691.5    | Prove request finalizers, concurrent context isolation, tracing, cancellation, and active-request shutdown using the selected integration        | Implemented — M       |
| #691.6    | Built exports/declarations and an isolated portable consumer work without Express or Bun platform dependencies. Include scoped validation, pac…  | Implemented — M, W, R |
| #692.1    | Ship the Dashboard Effect serving adapter without mounting Management or starting a server                                                       | Implemented — D       |
| #692.2    | Share rendering/runtime configuration and safe asset/fallback behavior with Express where practical, retaining the asset-only Dashboard package  | Implemented — D       |
| #692.3    | Preserve independent Dashboard and Management mounts, deep links, GET/HEAD behavior, cache headers, missing-asset responses, and safe path han…  | Implemented — D       |
| #692.4    | Validate an actual configured Dashboard load and RPC read/mutation against the existing Express Management integration before the combined nat…  | Implemented — D       |
| #692.5    | Authentication can protect HTML and assets                                                                                                       | Implemented — D, H    |
| #692.6    | Consume built package exports through a portable Effect host without Express/Bun dependencies                                                    | Implemented — D, W, R |
| #693.1    | BunRuntime/BunHttpServer and their platform dependencies appear only in private application composition, never shipped adapters                  | Implemented — H, W    |
| #693.2    | Use one scoped Monque instance and host-owned MongoDB client                                                                                     | Implemented — H       |
| #693.3    | Host authentication protects both Management transports, OpenAPI discovery, Dashboard HTML, and assets. Pass host identity through native adap…  | Implemented — H       |
| #693.4    | Run the actual example as a Bun subprocess against real MongoDB                                                                                  | Implemented — H       |
| #693.5    | Release HTTP work before Monque and then the database, with telemetry released according to ownership. Document interruption limits and do not…  | Implemented — H       |
| #693.6    | Update documented setup/start/test commands and prove a browser deep link plus permitted/denied operations against the combined host             | Implemented — H, B    |
| #694.1    | Extend the existing test harness with an adapter/project matrix and explicit commands                                                            | Implemented — B       |
| #694.2    | Use isolated ports, MongoDB fixtures, readiness checks, and reliable teardown                                                                    | Implemented — B       |
| #694.3    | Run shared applicable deep-link, reads, mutation, pagination/polling, and capability workflows against both hosts                                | Implemented — B       |
| #694.4    | Exercise host authentication and adapter-provided authorization on both: distinct identities, allowed/denied actions, effective read-only capa…  | Implemented — B, T, M |
| #694.5    | Ensure the same built Dashboard is served by the actual Express and Effect Dashboard adapters                                                    | Implemented — B, W    |
| #694.6    | Keep lifecycle/signal tests in the real Bun process suite and protocol/operation cases at their public request seam rather than duplicating ev…  | Implemented — H, M    |
| #695.1    | Run full workspace builds and required checks, all relevant existing package suites, package export/declaration validation, Effect linting, du…  | Implemented — W, B, H |
| #695.2    | Verify core, Management, Dashboard, Express adapters, Ts.ED integration, development/docs applications, and other existing consumers retain su…  | Implemented — W       |
| #695.3    | Remove only obsolete private migration scaffolding after all callers have moved                                                                  | Implemented — O, P    |
| #695.4    | Check packed adapter dependency graphs and isolated portable usage: no Express/Bun dependency enters published native adapters, and no server …  | Implemented — W, D    |
| #695.5    | Finalize ADR/glossary and setup/authentication/authorization/transport/lifecycle docs, including exact package version compatibility and both …  | Implemented — R, H    |
| #695.6    | Recheck release state, amend relevant unreleased changesets while preserving unrelated notes, and add new adapter package release entries. Do …  | Implemented — R       |
| #695.7    | Run repository-required validators for any changed CI/YAML/shell/Docker artifacts. Individual tickets must already include scoped tests          | Implemented — W       |

## Parent user stories

| Story | Final evidence        |
| ----- | --------------------- |
| US1   | Implemented — M       |
| US2   | Implemented — D       |
| US3   | Implemented — H       |
| US4   | Implemented — W       |
| US5   | Implemented — M, D, H |
| US6   | Implemented — H       |
| US7   | Implemented — O, M    |
| US8   | Implemented — H, B    |
| US9   | Implemented — O, M    |
| US10  | Implemented — O, M    |
| US11  | Implemented — M, P    |
| US12  | Implemented — O, B    |
| US13  | Implemented — T, B    |
| US14  | Implemented — T       |
| US15  | Implemented — T       |
| US16  | Implemented — D, B    |
| US17  | Implemented — D, B    |
| US18  | Implemented — B       |
| US19  | Implemented — T, D    |
| US20  | Implemented — M, P    |
| US21  | Implemented — H, R    |
| US22  | Implemented — H       |
| US23  | Implemented — H       |
| US24  | Implemented — O, W    |
| US25  | Implemented — W       |
| US26  | Implemented — O, T    |
| US27  | Implemented — R, H    |
| US28  | Implemented — R       |
| US29  | Implemented — W       |
| US30  | Implemented — H, W    |
| US31  | Implemented — D, B    |
| US32  | Implemented — T       |
| US33  | Implemented — O, T    |
| US34  | Implemented — T, M    |
| US35  | Implemented — T       |
| US36  | Implemented — P       |
| US37  | Implemented — R, W    |

## Parent decisions and testing decisions

### Implementation Decisions

| Decision (source order) | Subject                                                                                                                                      | Evidence / disposition                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1                       | Add public `@monque/management-effect` and `@monque/dashboard-effect` packages following the repository's existing adapter split             | Implemented — M, D                                                      |
| 2                       | Expose mountable Effect HTTP routes/layers for both Management transports without starting a listener, registering process signals, or cr…   | Implemented — M, H                                                      |
| 3                       | Use portable Effect HTTP, context, scope, filesystem/path, and service interfaces in shipped code                                            | Implemented — M, D, W                                                   |
| 4                       | First implementation milestone: use a temporary, minimal compatibility proof to exercise the official oRPC v2 Effect integration under a …   | Implemented — P                                                         |
| 5                       | If the proof passes, pin all participating oRPC packages to one compatible v2 beta release and migrate server, shared contract, Dashboard…   | Implemented — P, R                                                      |
| 6                       | If the proof fails a required lifecycle guarantee, record the failing behavior and stop the dependent migration for an architecture decision | Conditional stop rule respected; gate passes, so stop not triggered — P |
| 7                       | Execute native Management requests through the scheduler's Effect interface and Effect-native application hooks                              | Implemented — O, M                                                      |
| 8                       | The official integration runs Effects through a Promise runner and explicitly provided context; it is not automatically a child of the Ef…   | Implemented — M, P                                                      |
| 9                       | Refactor shared Management operations, authorization policy, DTO mapping, and errors as needed to support native execution and existing c…   | Implemented — O                                                         |
| 10                      | Keep one authoritative shared oRPC contract/router and Management operation implementation                                                   | Implemented — O, T                                                      |
| 11                      | Switch the Dashboard client from OpenAPILink to RPCLink and retain oRPC's TanStack Query utilities for queries, mutations, pagination, an…   | Implemented — D, B                                                      |
| 12                      | Define a distinct RPC submount under the host-configured Management mount, without changing the existing versioned HTTP paths or OpenAPI …   | Implemented — T, D                                                      |
| 13                      | Preserve the public OpenAPI HTTP contract, including input coercion, query/body encoding, DTO serialization, status codes, and the existi…   | Implemented — T                                                         |
| 14                      | Treat oRPC v2 adoption as a real migration: routing metadata, package imports, handler/plugin APIs, middleware execution, serialization, …   | Implemented — T, R                                                      |
| 15                      | ADR-0003's framework-neutral Management Surface and ADR-0006's asset-only Dashboard separation remain in force                               | Implemented — R                                                         |
| 16                      | Keep shared native failures in the Effect error channel, mapping domain failures to declared oRPC errors at the transport seam               | Implemented — O, T                                                      |
| 17                      | Apply authentication, capabilities, read-only policy, action authorization, payload redaction, validation, body limits, and origin protec…   | Implemented — T, M                                                      |
| 18                      | Support Effect-native authorization, request context, and default/per-Job-Name payload serialization with application services               | Implemented — O, M, H                                                   |
| 19                      | Propagate request interruption into native operations and hooks                                                                              | Implemented — M, R                                                      |
| 20                      | Share Dashboard HTML rendering, mount-aware runtime configuration, asset path handling, and fallback decisions between serving adapters w…   | Implemented — D                                                         |
| 21                      | Relocate the existing Effect host from workspace applications into the top-level examples directory, retaining its recognizable Effect ho…   | Implemented — H, W                                                      |
| 22                      | Convert the private Effect host example to BunRuntime and BunHttpServer                                                                      | Implemented — H                                                         |
| 23                      | Use a single application scope and platform lifecycle handling                                                                               | Implemented — H                                                         |
| 24                      | Internal refactors across existing packages are allowed and expected when needed                                                             | Implemented — W                                                         |
| 25                      | Keep existing Express and other integrations, their public contracts, and their supported runtime expectations                               | Implemented — O, W, R                                                   |
| 26                      | Integrate the new packages into workspace builds, declarations, package validation, relevant CI checks, and Effect linting                   | Implemented — W                                                         |
| 27                      | Amend relevant pending changesets to describe the final unreleased feature, retaining unrelated release notes                                | Implemented — R                                                         |

### Testing Decisions

| Decision (source order) | Subject                                                                                                                                    | Evidence / disposition |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| 1                       | Primary seam: public requests to the mounted Management interface                                                                          | Implemented — T, M     |
| 2                       | Make the focused compatibility proof the first gate for adopting the v2 beta                                                               | Implemented — P, M     |
| 3                       | Cover the complete Management Route Map: reads, capabilities, single/bulk mutations, processing controls, unsupported operations, authori… | Implemented — T, M     |
| 4                       | Exercise native application services through RPC and OpenAPI HTTP requests: Effect authorization/serialization hooks can read provided se… | Implemented — M        |
| 5                       | Exercise the Dashboard through mounted HTTP routes: configured HTML, independent custom mounts, deep links, asset retrieval and cache pol… | Implemented — D        |
| 6                       | Verify that the relocated example is discovered by the workspace and that its documented build, start, and test commands work after a cle… | Implemented — H, W     |
| 7                       | Secondary seam only where HTTP tests cannot prove process lifecycle: start the actual example as a Bun subprocess against real MongoDB us… | Implemented — H        |
| 8                       | Adapt the existing Playwright host test pattern to the rebuilt RPC Dashboard                                                               | Implemented — B        |
| 9                       | Use native Effect tests and TestClock for deterministic Effect time behavior, and ordinary tests for existing synchronous/Promise compati… | Implemented — O, W     |
| 10                      | Verify built package exports/declarations and consume the adapters in an isolated portable Effect host without Express or Bun dependencies | Implemented — W        |
| 11                      | Run scoped checks during development, then complete the workspace build and required checks, all existing packages' relevant test suites … | Implemented — W        |

## Two fresh architecture passes (no HTML)

Both independent explorers read codebase-design, GLOSSARY and relevant ADRs.
Pass 1 checked depth/locality at native operations, compatibility, transport and
renderer seams. Applied its concrete release-range findings: Management adapters
now require 0.12.x. Dashboard's existing `workspace:^` dependency correctly becomes
^0.8.0 during Changesets versioning; projected-release packing now verifies that
artifact rather than forcing old manifests through transitive overrides. Added a
real RPC call to every root consumer scenario. The legacy core floor remains:
optional newer operations are capability-detected; raising it would remove valid
compatibility. Pass 2 retained the necessary public compatibility adapter and
independently pinned reproducible proof, bounded Bun cleanup with SIGKILL/reaping,
and corrected stale ADR descriptions. No speculative abstraction was warranted.

The core suite exposed a genuine test-clock assumption: MongoDB server timestamps
were bounded with the host wall clock. Its observed red run was 1093/1094; the
fixed regression bounds MongoDB timestamps with MongoDB `hello.localTime` while
moving Effect TestClock between 2099 and epoch zero. The isolated 10-case suite
and subsequent full 1094-case core suite pass. No scheduler behavior changed.

## Release reconciliation

Rechecked GitHub releases with `gh api repos/ueberBrot/monque/releases` before
editing: latest core 1.20.2, Management 0.11.1, Management Express 0.7.3 and Ts.ED
1.18.1 remain November 6; Dashboard 0.7.1 remains November 4. Published changelogs
and tags are untouched. Reviewed **every** pending note:

| Pending entry                 | Final disposition / rationale                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core-dependency-updates       | Retain independent runtime dependency feature; compatible Effect 4 minimum stays ^4.1.2 and is exercised in packed consumers.                             |
| dashboard-dependency-updates  | Retain independent bundled RPC client migration; coordinated server/assets required.                                                                      |
| dashboard-effect-serving      | New Effect serving package only; remove omnibus renderer/Express bump.                                                                                    |
| dashboard-shared-renderer     | Separate additive Dashboard renderer/fallback exports, minor.                                                                                             |
| dashboard-express-renderer    | Separate Express dependency on matching renderer, minor per repository dependency policy.                                                                 |
| effect-layer-setup            | Include setup-resource lifetime semantics in the unreleased setup feature; remove effect-setup-resource-lifetime iteration note.                          |
| initialization-error-cause    | Retain independent observable existing-facade error-cause fix.                                                                                            |
| management-dependency-updates | Retain coordinated beta migration/consumer instructions; split RPC feature out.                                                                           |
| management-rpc                | Independent protected dual-transport feature shared by Management and Express; both minor.                                                                |
| management-effect-adapter     | New native adapter only; shared native operation exports have their own entry.                                                                            |
| native-effect-entrypoint      | Retain independent supported import feature.                                                                                                              |
| native-effect-workers         | Retain independent native Worker/service/scope feature.                                                                                                   |
| native-management-operations  | Keep one shared native operations/router feature; remove historical implementation detail.                                                                |
| optional-operation-metrics    | Retain independent optional cumulative metrics feature, host reader ownership.                                                                            |
| optional-otel-tracing         | Fold failed-execution-outcomes into the unreleased tracing feature; do not present its implementation correction as a released regression.                |
| scoped-effect-scheduler       | Include correct interruption/admission and caller-clock disposal semantics; remove native-admission-interruption/native-disposal-context iteration notes. |
| terminal-scheduler-disposal   | Retain independent public terminal disposal feature distinct from native Layer composition.                                                               |
| tsed-terminal-teardown        | Retain independent Ts.ED teardown feature; core floor ^1.21.0 is necessary for dispose().                                                                 |

Projected versions: core 1.21.0, Management 0.12.0, Management Express 0.8.0,
Dashboard 0.8.0, Dashboard Express 0.5.0, Ts.ED 1.19.0; both exact new package
names release as 0.2.0. No private app/proof release: private versioning is disabled.
Changesets warns that future Management/core peers exclude current pre-release
workspace manifest versions; the projected release satisfies them. Do not weaken
those floors to silence that diagnostic.

Consumer packing uses Changesets' projected versions in disposable copies and
rewrites workspace dependency protocols to the resulting release ranges. Original
workspace versions and published history remain unchanged. All four root
scenarios now call real RPC and HTTP. `minimum-management` means the projected
0.12.0 artifact, since that minimum is not published yet; it no longer claims old
0.11.0 supports the new RPC adapter. Root transitive overrides still select the
scenario's packed artifacts, preserving the previous CI fix. Separate npm-based
native installation validates Management peers without those overrides. The
Dashboard portable installation verifies the projected ^0.8.0 renderer range.

## Validation and practical limits

Commands are from the root unless specified. Raw run logs are `/tmp/695-*.log`;
results below are the durable record, rather than a dependency on temporary logs.

| Check                                                                                     | Result                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp install --frozen-lockfile`; separately locked proof install                           | Clean dependency installation passed with filesystem/network escalation.                                                                                                                                                            |
| `vp run build`                                                                            | All 11 workspace builds passed, including docs and applications.                                                                                                                                                                    |
| `vp run type-check`                                                                       | All 17 tasks passed; strict typed lint and docs checks, zero diagnostics.                                                                                                                                                           |
| `vp run check:exports`                                                                    | All 24 tasks passed, built ESM/CJS declarations, publint and strict attw.                                                                                                                                                           |
| `vp run lint:effect`                                                                      | Core, Management and both adapters: zero errors/warnings/messages.                                                                                                                                                                  |
| Workspace test tasks, sequential `--ignore-depends-on --concurrency-limit 1` after builds | Core 1094, Ts.ED 131, Management 315, Management Express 30, Management Effect 3 portable + 18 actual Bun, Dashboard 119, Dashboard Express 25, Dashboard Effect 15, dashboard-dev 121, actual Bun example 25: all passed.          |
| `bun test proofs/orpc-effect/proof.test.ts`                                               | 14 passed, real RPC/HTTP and lifecycle.                                                                                                                                                                                             |
| `vp test run --project ci`                                                                | 18 passed. CI now explicitly runs real Bun example lifecycle tests and both isolated packed adapters, retaining proof/browser prerequisites and transitive overrides.                                                               |
| Full six-project Playwright matrix, disposable `mongo:8`, URL `directConnection=true`     | **434 passed**, 2.5 minutes, no retries; actual Express/Bun adapter projects plus all four retained desktop/mobile/auth projects.                                                                                                   |
| `bun scripts/verification/consumer.mts --skip-build`                                      | All 4 projected release scenarios passed: core minimum, Management minimum candidate, current, MongoDB 6; RPC/HTTP, native services, Ts.ED/Mongoose and persisted upgrade data.                                                     |
| Both native `tests/consumer` commands                                                     | Isolated Node runtime/declarations/ESM/CJS and assets passed; no Express/Bun runtime graph. Dashboard host explicitly supplies platform-node; published adapter does not depend on it.                                              |
| Built browser assets (`dist/client/assets/*.js`)                                          | No MongoClient/native router/effect context/runner implementation markers. Type-only contract imports and packed graph inspected; marker scan supplements runtime consumer checks.                                                  |
| `actionlint`; yamllint with existing workflow conventions                                 | Actionlint passes. YAML has inherited pinned-action comment-spacing warnings; no errors.                                                                                                                                            |
| `zizmor` on both changed workflows                                                        | 12 inherited findings: 7 low-confidence medium credential/artifact findings, 5 low self-repository findings; no high. The earlier baseline of 11 scanned CI only; the twelfth is the pre-existing Dashboard-image checkout finding. |
| `hadolint packages/dashboard/Dockerfile`                                                  | Same baseline warnings DL3018/DL3025 and info DL3066; no new finding.                                                                                                                                                               |
| `shellcheck scripts/ci/*.sh`; `shfmt -d scripts/ci/*.sh`                                  | Shellcheck passes. shfmt reports inherited indentation/redirection style differences in unchanged scripts; no shell artifact was edited.                                                                                            |

Cancellation does not roll back MongoDB writes. Arbitrary FiberRef inheritance,
cross-major oRPC interoperability and untested Effect HTTP versions are not
promised. Both adapters pin Effect HTTP 4.1.4; core/legacy Management retain their
separately tested compatible range. The proof remains independently locked and
reproducible; it is not obsolete scaffolding. `compatibility.ts` still serves
public synchronous/Promise callers. No second production operation implementation
or old apps/effect-host copy remains. The independent relocation is preserved in
commit `5d7573f` before the dependent native migration.

An initial browser command constructed an invalid MongoDB URL and was stopped.
A corrected run overlapped declaration builds and exposed missing dist files
(431/434 passed); those failures are not accepted as successful verification.
The complete matrix rerun with build outputs settled passed all 434 cases.
No push, publication, PR mutation, issue closure or watch was performed.

## Independent final review and correction

Two fresh reviewers inspected `1057e7a...b4fc3b9` independently. The Spec axis
reported no missing, partial or incorrect requirement. The Standards axis found
one actionable packaging issue: the Dashboard Docker install stage omitted both
new adapter manifests even though the example depends on those workspaces.
The unchanged build failed locally and in CI with both workspaces “listed in
bun.lock but not on disk.” Added their manifest COPY instructions before the
frozen install; the complete image build then passed.

The repository's unchanged `dashboard-image.sh` container acceptance script also
passed: invalid configuration, all assets and deep links at three mounts, GET/HEAD,
cache/compression, method and missing-asset responses, non-root/read-only runtime,
custom port, health, shutdown and safe runtime configuration. On macOS it requires
GNU timeout and sed; Homebrew coreutils/gnu-sed supplied those Linux prerequisites.
Hadolint reports only the previously recorded DL3018/DL3025/DL3066 baseline.
No further review finding remains. All ten completed implementation worktrees were
confirmed clean and fully integrated before removal; their commits remain in Git.

The subsequent CI run also exposed two runner-only setup issues. Backend browser
installation now runs in `apps/dashboard-dev`, where the pinned Playwright command
is available. Packed consumer verification checks out full history and prepares
the Changesets `main` comparison ref. An isolated shallow clone reproduced the
missing-ref failure; fetching history and creating the comparison ref passed and
preserved the full projected release plan (including core 1.21.0 and Management
0.12.0). Actionlint, configured YAML validation and formatting pass. All six CI
browser projects passed on the audited head; the frontend matrix job was stopped
by fail-fast after backend prerequisite failure, rather than a frontend assertion.
