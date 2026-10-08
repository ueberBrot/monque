# Stabilization verification

The verification branch adds two repeatable checks: an application that installs packed
packages outside the workspace, and a workload that exercises multiple scheduler
processes through failures. The library's runtime code is unchanged.

## Results

Checked on 8 October 2026, starting from commit
`468c5306bdca3c312d8daa801b7d0c28bdc0152d`, on macOS arm64 with Node.js 24.18.0 and
Bun 1.4.2.

- `vp run test:all` passed: 1,540 Vitest tests and 420 Playwright tests. Browser coverage
  includes desktop and mobile, with and without authentication.
- `vp run build` passed for all six packages and both applications. The documentation
  build produced 208 pages. Package builds ran the configured export and type-resolution
  checks. Existing bundle-size warnings remain.
- `vp run type-check` passed, including the Core and Management Effect diagnostics.
  Astro reported no errors, warnings, or hints.
- Repository formatting and lint checks passed. `git diff --check` passed.
- All three [consumer cases](./consumer.md) passed. They cover the current packages,
  the lowest published Core version allowed by the peer range, and Management 0.8.0.
  The upgrade preserved Job fields and full index definitions, including index options.
- The [operational workloads](./operational.md) completed 240 and 1,200 finite Jobs,
  respectively, with retries and recurring work. Both recovered from worker termination
  and a database pause. Their JSON artifacts contain the measurements and environment.

A separate cancellation smoke check replaced Bun with a temporary process that ignored
SIGTERM and spawned a child. Cancelling the consumer runner terminated both processes,
removed its temporary application, and returned failure. An operational timeout check
also returned failure, removed an earlier passed report, and left no workload container.

The independent script review found gaps in index comparisons, cancellation ordering,
stale reports, and shutdown exit checks. Those checks now compare full index definitions,
wait for child exit before cleanup, remove previous output before a run, and require
surviving workers to exit successfully.

These local checks establish a baseline after the latest version commit's cancelled CI
run. They do not change that run's GitHub status. The measurements describe short runs on
this host, not production capacity or a long memory soak. Replica-set failover and
external side-effect correctness remain outside the operational exercise.

## Reproduce

```sh
vp install --frozen-lockfile
vp run test:all
vp run build
vp run type-check
vp fmt --check
vp lint --deny-warnings
vp run verify:consumer
vp run verify:operational
```

Docker and registry access are required. Use the consumer and operational guides for
workload settings, supported combinations, output paths, and cleanup behavior.

## Writing review

The documentation was edited with writing-clearly-and-concisely, clear-writing,
humanizer, and readability. Sentences state the behavior and its limits directly;
technical terms such as concurrency and idempotency remain where they carry meaning.

The readability estimates for the consumer guide are reading ease 44.2,
Flesch-Kincaid grade 10.3, Fog 13.1, and SMOG 12.3. Its 395 words average 12.7 words per
sentence. The operational guide's estimates are in
[its readability report](./operational-readability.json). These guides address software
maintainers. Technical vocabulary raises the scores; replacing it would obscure the
contracts. Code, headings, and inline literals are excluded from the estimates, which
use heuristic syllable counts rather than a pronunciation dictionary.
