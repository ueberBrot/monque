# Three additional architecture passes (#685)

Starting head: `05c80bb`. Branch `refactor/native-effect-architecture` starts at
`feat/native-effect-integration`; fetching and merging the remote integration tip
reported already up to date. These are three additional sequential passes after
the acceptance audit, not a reuse of its earlier two passes. Each pass uses one
fresh-context read-only explorer; the implementation agent evaluates findings and
validates the current result before starting the next pass. User overrides:
Markdown only, no HTML or grilling, no speculative seams, unchanged package names.

## Pass 1

Disposition: no code change. Independently explored `1057e7a...HEAD`, native
Management operations/policy, dual RPC/OpenAPI protection, portable request bridge,
Dashboard renderer and both serving adapters, Bun host lifecycle, browser matrix,
and projected release tooling against GLOSSARY and ADRs 0003–0007/0009.

The deletion test supports retaining these modules: deleting compatibility would
spread optional capabilities, deferred invocation, receiver preservation and error
conversion into native operations; deleting protected surface assembly or rendering
would duplicate behavior across real RPC/OpenAPI and Express/Effect adapters.
These interfaces provide depth and leverage with locality. The Effect bridge
must reconstruct effective host URL/headers because installed `toWeb` can return
the original Web request; Context/Scope capture, combined cancellation and runner
joining serve actual host adapters. Splitting the Bun composition would scatter
resource-ordering knowledge. A common filesystem/HTTP serving module would add an
interface without removing adapter-specific complexity. The independent locked
proof and projected-release packer test different real compositions; retain both.
No accepted ADR, domain term or release behavior changed; no changeset needed.

Verification before pass 2:

- `vp install --frozen-lockfile`: passed (shared Bun cache required escalation).
- `vp run skills list`: installed inventory checked; no matching dependency skill
  for the inspected Effect/oRPC modules. Installed Effect AGENTS, resources
  examples and relevant source consulted. No dependency code edited.
- `vp run --filter './packages/*' build`: passed, all eight package builds.
- `vp test run --project @monque/management --project @monque/management-effect --project @monque/dashboard-effect --project @monque/management-express --project @monque/dashboard-express`:
  388/388 tests, 22 files, passed with local-listener/Docker escalation. Initial
  sandbox run failed 54 listener checks with EPERM; it is not counted as a pass.
- `bun test packages/management-effect/tests/bun`: 18/18, 119 assertions, passed.
- `vp run lint:effect`: passed, zero diagnostics for core, Management and both
  Effect adapters.

## Pass 2

Disposition: documentation clarification only; no production refactor warranted.
Fresh exploration independently traced the whole affected work again. The native
and legacy scheduler adapters vary in receiver binding, synchronous/Promise error
conversion and live optional capabilities; retain the compatibility module.
Shared transport policy and renderer retain depth at real dual-transport and
Express/Effect seams. Extracting transport-selection expressions or a generic
host module would add interface with no leverage and reduce lifecycle locality.

Release verification limit: `packRelease` projects copied manifests and dependency
ranges without rebuilding copied `dist`. Management's build embeds its manifest
version in OpenAPI discovery (`packages/management/vite.config.ts`); current built
output reports `0.11.1` while the projected candidate manifest is `0.12.0`.
These archives verify compatible ranges, exports and runtime behavior, not
byte-equivalence or embedded version metadata of final release builds. Production
Changesets versioning precedes `release:publish`, which builds packages before
publishing. Record the limit here; string rewriting or another staged build module
would add complexity without improving the intended compatibility interface.
No release change or changeset is warranted.

Verification before pass 3:

- Separate `vp test run --project @monque/dashboard`, `--project @monque/dashboard-dev`
  and `--project ci`: 119/119, 121/121 and 18/18 passed. A combined invocation
  rejected differing existing worker settings before running tests; separate
  commands match repository execution and passed.
- `vp run check:exports`: 24/24 tasks passed, with shared npm cache escalation
  after the sandbox attempt failed in `npm pack`.
- `bun packages/management-effect/tests/consumer/verify.mts` and
  `bun packages/dashboard-effect/tests/consumer.mts`: both isolated Node consumer
  checks passed, including projected ranges, ESM/CJS and runtime behavior without
  Express/Bun runtime dependencies.
- `vp run build`: all 11 workspace builds passed.
- `vp run type-check`: all 17 tasks passed after installing the independently
  locked proof with `vp install --frozen-lockfile` in `proofs/orpc-effect` (the
  first run correctly rejected its missing Bun types).
- `bun test proofs/orpc-effect/proof.test.ts`: 14/14 passed, 43 assertions.

## Pass 3

Disposition: no additional code change. A third fresh explorer independently
examined the complete affected work against the same domain and Effect guidance,
including real adapter implementations and request/process/browser regressions.
The native dependency interface, compatibility adapter, operations and action
policy preserve depth: optional capability getters, original receivers,
authorization, redaction and mapping remain local. RPC/OpenAPI share protection
without obscuring their distinct error contracts. The portable request module
hides Context/Scope capture, effective metadata reconstruction, combined aborts
and runner joining behind its host interface.

Dashboard rendering/fallback already has two real adapters; adding a filesystem
seam would add interface without demonstrated leverage. Bun's sequential child
Scope preserves ordering under parallel parent finalization. Browser workflows
share the public interface across actual Express/Bun hosts, while process tests
observe shutdown. The three packed consumers share projection/packing but need
different runtime/dependency graphs; a generic consumer framework would add
configuration complexity. The one-caller three-line `concurrently` helper was
also considered: removing it offers negligible leverage and does not deepen a
module. Retain its explicit calling-fiber ownership. No accepted domain or ADR
change is justified, and no runtime/release change requires a changeset.

Final verification and integration:

- `vp test run --project @monque/effect-host`: 25/25 passed across two files,
  exercising the actual Bun application and disposable `mongo:8`, with
  `directConnection=true` as constructed by the existing tests.
- The earlier current-code validations remain applicable: no source changes
  occurred between passes. In total, 803 tests passed across the recorded scoped
  runs, plus both isolated packed Node consumers. Full build (11 tasks), type
  check (17 tasks), export checks (24 tasks), and Effect lint passed. Task caching
  was retained where inputs were unchanged.
- `vp fmt --check proofs/orpc-effect/architecture-three-more-passes.md` and
  `git diff --check`: passed.
- Fetched and merged `origin/feat/native-effect-integration` again after the
  exploration: already up to date at full integration head
  `05c80bbca5ff591669c415b2982cbeb6c58ffd16`.
- No full six-project browser matrix rerun: no behavior changed; the scoped
  Dashboard Effect suite includes its actual browser integration test, and the
  existing matrix, host fixture and workflows were inspected independently.
  No additional core-wide regression run was needed for a documentation-only
  result. Previous audit results are historical evidence, not claimed as rerun.

Exactly three fresh exploration subagents were used sequentially, with evaluation
and validation before each next pass. The durable change is this report,
including the release-verification clarification. Package names, public
synchronous/Promise/HTTP contracts and host lifecycle/context/scope/cancellation/
tracing behavior remain unchanged. No HTML review artifact, push, PR mutation,
issue closure or watch was performed.
