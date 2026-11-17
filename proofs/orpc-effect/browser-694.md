# Actual hosting adapter browser matrix (#694)

The clean checkout began at integration `5d3e3f15701b55cc2df65bda898099d41f139455`.
Merged integration `32950d7538f53d5de7a450f02b6d141a99fcaaa4`, preserving the parent's
CI browser prerequisites and packed-consumer dependency fixes.

`apps/dashboard-dev` now has `host-express` and `host-effect` Playwright projects.
Both serve the same built `@monque/dashboard` assets with their actual Dashboard
and Management adapters, using real RPC. The Effect project launches the existing
example CLI as an actual Bun subprocess using its documented environment/readiness
contract. Express also runs under the workspace-pinned Bun, with real Express routers.
Each test owns a random MongoDB database and port-zero listener. Readiness includes
the application log and authenticated capabilities request. Teardown is idempotent,
bounds graceful shutdown with kill/reap fallback, and independently disposes the
request context, process, database and client, including setup failure paths.

Shared browser workflows cover Job and Queue View deep-link reloads, reads,
mutations, cursor pagination/reload, external mutation polling, host authentication,
viewer/operator capability differences, action-specific deletion denial, read-only
UI/direct mutation enforcement, and failing authorization hooks. Direct requests
retain policy bypass checks. The failure variant embeds the same Effect host with
a native failing hook through its optional native authorization interface. Signal,
resource lifetime, full operation/protocol semantics remain in existing actual Bun
and adapter request suites. No protocol mocks or UI adapter selector were added.
The four legacy desktop/mobile/auth projects and mock/db/unit workflows remain.

Commands: `vp run @monque/dashboard-dev#test:hosts`, `#test:db`, and `#test:e2e`.
`#start:effect` provides the explicitly separate interactive built Dashboard startup.
CI now selects all six projects and retains the incoming browser prerequisite fix.

## Architecture and implementation discipline

Both required architecture passes used fresh explorers, codebase-design vocabulary,
GLOSSARY and ADRs 0003/0005/0006/0009. No HTML was generated.

1. Keep the legacy fixture unchanged: its scheduler/session interface does not fit
   an actual subprocess. A dedicated actual-host fixture concentrates readiness,
   lifetime and Mongo ownership behind the browser/request seam. Reuse the existing
   Bun CLI rather than inventing another Effect host. Applied.
2. Use explicit adapter options instead of project-name substring inference. Make
   cleanup idempotent and release later resources when earlier cleanup fails. Remove
   the Express adapter's import of a Dashboard source predicate. Assert read-only
   Job controls as well as the health banner and direct denial. Applied. The native
   example hook interface reuses existing Management types; no new domain/ADR needed.

TDD used the pre-approved browser/public request seams. The first project invocation
failed before registration; subsequent real RPC workflows established the host
fixture. Fault requests initially failed input validation instead of reaching the
hook; switching to a valid seeded Job cancellation established safe 500 behavior.
The installed dependency skill inventory has no matching permitted Effect, Express,
MongoDB, Playwright or Vite configuration skill. Installed Effect AGENTS, HTTP server
examples and relevant Effect/HttpRouter sources supplied dependency guidance. Read
the compatibility/migration/adapter reports and the example README before composing.

## Verification

- Workspace build: 11/11 tasks passed, including docs and applications.
- Workspace exports/declarations: 24/24 tasks passed (publint and strict attw).
- Strict affected type-aware lint/type-check and formatting passed.
- Root and example Effect diagnostics: zero errors, warnings or messages.
- Shared Management: 315 tests passed.
- Management Express: 30 tests passed; Management Effect: 3 portable tests plus
  18 actual Bun protocol/operation/lifetime tests passed.
- Dashboard: 119 tests; dashboard-dev unit: 121 tests; Dashboard Express: 25 tests;
  Dashboard Effect: 15 tests passed.
- Actual Bun example: 25 tests passed, including process signals/lifetime, real
  MongoDB, requests and browser integration; rerun after final example changes.
- Full six-project browser matrix: **434 passed** (2.8 minutes), including all
  10 actual-host cases and all 424 retained desktop/mobile/auth cases.
- actionlint passed. yamllint passed with existing pinned-action comment-spacing
  warnings (default rules except long lines, document marker and YAML truthy keys).
  zizmor reports the same baseline findings: 11 below high severity, 2 suppressed;
  no high findings, verified against the integration workflow. No shell scripts changed.

Validation uses Docker Desktop with disposable `mongo:8`, standalone
`directConnection=true`, and real Chromium. An initial full browser attempt had
one legacy worker-polling timeout while checks ran concurrently; the complete
matrix was rerun after fixing the two new fault-request input errors. The final
434-test run passed without retries. No unresolved verification blocker remains.

No push, PR creation, issue closure, publication or PR watch was performed.
