# Portable Dashboard Effect serving (#692)

Base confirmed: clean checkout at `48c607ef2ba687d665510d175153223abb9555c8`.
Before completion, `git merge feat/native-effect-integration` reported already up
to date at that same integration tip. Parallel #691 had not landed there.

The published package is exactly `@monque/dashboard-effect`. It exports
`dashboardEffectLayer`, portable Effect HTTP routes only, with no Management
mounting, runtime runner or listener. Host authentication wraps all routes;
platform services are supplied at the request seam. `apiBaseUrl` accepts a string
or a native Effect using request identity/services. Dashboard and Management
mounts are independent. The Dashboard still ships one asset-only build.

The asset package now owns shared HTML rendering, mount-aware asset rewriting,
script escaping and fallback classification. Express retains its public options,
Promise resolver and static middleware. The Effect adapter uses host FileSystem,
Path and HttpPlatform, checks decoded paths and canonical asset containment,
serves GET/HEAD, immutable assets, uncached HTML and 404s for missing assets.
No #691 Management or shared request bridge modules were edited.

## Architecture passes

Both required passes used fresh exploration agents, codebase-design vocabulary,
GLOSSARY and ADR-0006. No HTML reports were generated, per task instruction.

1. Before implementation: extract shared HTML rendering into the asset package,
   keeping HTTP and filesystem behavior in adapters. Two adapters establish a
   real seam; deleting the rendering module would redistribute escaping and
   mount rewriting, so its interface earns depth and improves locality. Applied.
   No generic HTTP dispatcher was added. Node path helpers remain compatible;
   the isolated Node host proves the requested Express/Bun-free runtime graph.
2. After implementation: no correctness blocker. Hide fixed HTML marker/global
   constants inside the renderer to shrink its interface, and test native
   request-service URL resolution through public HTTP. Both applied. No new
   Management abstractions or speculative modules were added.

TDD used the spec-approved public HTTP/browser seams. A configured deep-link
request failed before the working route implementation; further request tests
cover assets, HEAD, missing files, unsafe paths, symlink escape and host request
services. Installed Effect AGENTS, relevant HTTP examples and module sources were
read. `vp run skills list` offered no matching permitted Effect/Express dependency
skill; installed sources supplied the dependency guidance. TDD, codebase-design,
architecture exploration and browser stub instructions were loaded.

## Verification

- Workspace build: 10 tasks passed (including new package and example).
- Workspace strict type-aware lint/type-check: 16 tasks passed.
- Effect diagnostics: core, Management and Dashboard Effect, zero findings.
- Dashboard Effect: 15 tests passed, including real MongoDB/Chromium integration.
- Dashboard Express: all 25 serving tests passed after shared renderer changes.
- Dashboard: all 119 tests passed.
- Packed adapter exports/declarations: publint and strict attw passed; build also
  validates the shared Dashboard package.
- Isolated packed Node consumer: ESM and CommonJS exports, actual configured HTML
  and built assets passed without Express or Bun packages installed. Reproduce
  with `vp run @monque/dashboard-effect#verify:consumer`.
- Docs: 220 pages built, all internal links valid; Astro checks passed.
- Formatting and diff whitespace passed.

The integration fixture mounts the portable handler and the existing Express
Management router at `/custom/ui` and `/custom/control`, using one host cookie
identity policy and disposable `MongoDBContainer("mongo:8")` with
`directConnection=true`. Chromium loads/reloads a real Job deep link, observes
actual RPC reads, performs the pause mutation, observes the resumed control and
checks viewer denial. No fetch/protocol mocks are involved. The shared browser
also loaded the configured Job and Health deep links and observed successful RPC
job, health, processing-state and capability POSTs and polling. An opaque UI
navigation locator was rejected by approval review; explicit read-only URL
navigation completed that check, and the automated browser suite covered mutation.
The shared tab, fixture listener, scheduler, client and container were released.

Early invocation issues (sandbox cache/listener restrictions, missing standalone
proof dev dependencies, an incorrect UI button label and concurrent generated
docs cache use) were resolved. The final checks above passed. No unresolved
verification blocker remains. Unchanged core/Ts.ED runtime suites and the complete
combined native host are outside this scoped adapter validation; parent #695
owns final combined-host/release integration.

A new pending changeset records the new package and the two changed shipped
packages; parent #695 finalizes release metadata. No publication, push, PR,
issue closure or PR watch was performed.
