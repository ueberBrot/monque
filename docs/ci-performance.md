# CI performance snapshot: 2026-11-17

The audit covers the latest 150 CI runs available at 11:42:40 UTC on November 17,
from November 2 through November 17: 107 successful, 20 failed, and 23 cancelled.
Job and step timestamps come from GitHub's Actions API, using the latest attempt
of each run. Failed and cancelled runs remain in the census but are excluded from
the successful-runtime latency baseline.

## Baseline

The exploratory sample contains 17 successful runs with all six Dashboard E2E
projects, including both host projects. Fourteen are pull requests. This sample
spans three workflow revisions and several dependency/cache states; equal job
names do not establish equivalent work. It describes observed costs, rather than
a homogeneous performance baseline or an expected speedup. With fourteen PRs,
the nearest-rank p95 below is simply the slowest observation.

All durations below are seconds. Percentiles use the nearest-rank method. Queue
time is job creation to runner start; setup is runner start to the first check or
test command; execution includes the remaining checks, artifact handling, and job
cleanup. Job dependency waits precede job creation and are not runner queue time.
Percentiles of separate phases do not add up to percentiles of total duration.

| Job                          | Queue p50 / p95 | Setup p50 / p95 | Execution p50 / p95 |
| ---------------------------- | --------------- | --------------- | ------------------- |
| Quality & Package Builds     | 2 / 4           | 46 / 80         | 84 / 126            |
| Build Apps                   | 2 / 16          | 44 / 77         | 20 / 30             |
| Test (backend)               | 2 / 48          | 67 / 96         | 141 / 151           |
| Test (frontend)              | 2 / 16          | 47 / 64         | 32 / 42             |
| MongoDB Driver Compatibility | 2 / 16          | 35 / 49         | 48 / 58             |
| E2E mongo-desktop            | 2 / 16          | 93 / 144        | 116 / 125           |
| E2E mongo-mobile             | 2 / 16          | 98 / 146        | 95 / 115            |
| E2E mongo-desktop-auth       | 2 / 48          | 83 / 134        | 93 / 123            |
| E2E mongo-mobile-auth        | 2 / 15          | 79 / 109        | 113 / 122           |
| E2E host-express             | 2 / 16          | 89 / 122        | 17 / 21             |
| E2E host-effect              | 2 / 16          | 89 / 107        | 18 / 20             |
| CI Gate                      | 2 / 3           | 3 / 8           | 3 / 3               |

PR completion, from workflow creation to the last job completing, is 373 seconds
at p50 and 423 seconds at p95. Summed runner execution across all jobs is 1,561
seconds at p50 and 1,662 at p95 in the 17-run cohort. These are elapsed runner
seconds, not billed minutes or monetary costs.

Inside the original quality job, package builds take 5 / 13 seconds at p50 / p95,
fast lint 19 / 23, and typed lint plus type checking 46 / 66. Runtime jobs wait for
all of these checks before starting. Keep format, fast lint, CI-script tests, and package builds in the initial job.
After uploading package-only artifacts, move combined typed checks into the
existing app-build job. Runtime jobs can then overlap typed checks without adding
another runner setup. That app job generates API documentation once, checks docs,
and builds apps, explicitly skipping package dependencies already satisfied by the
artifacts. Compare completion time, failure latency, and total runner work.

The four newest typed-check observations are 35, 30, 25, and 26 seconds; the
main-branch reference is 30 seconds. The older 46-second median is not an estimate
of time this change will save. The reference log confirms a dependency-cache hit,
a Vite task restore-key hit, and eight package-build task hits. Cache states were
not collected for every historical run, so no cache-hit rate is claimed.

Across all 150 runs, summed execution of jobs assigned a runner is 136,474 seconds
for successful runs, 11,769 for failed runs, and 13,548 for cancelled runs. These
census totals include older workflows and are not comparable per-change costs.
Among the twenty failed runs, the first failing step completed at a median 129
seconds from workflow creation. Eight first failed during typed checks and none
during format or fast lint. Parallelizing typed checks can therefore waste runtime
work on typed failures; compare failure latency as well as successful completion.

Across the 102 E2E job samples, container initialization takes 26 / 35 seconds,
Vite+ setup 42 / 58, and Chromium installation 15 / 29 at p50 / p95. Those costs
justify investigating setup reuse before buying runners or adding shards. Queue
time is usually short, so this snapshot does not justify a runner-provider change.

## Reproducing the audit

List runs with `gh run list --repo ueberBrot/monque --workflow ci.yml --limit 150`.
For each run, request
`gh api 'repos/ueberBrot/monque/actions/runs/<id>/jobs?per_page=100&filter=latest'`.
Use job `created_at`, `started_at`, and `completed_at`, plus the corresponding step
timestamps. If the workflow grows beyond 100 jobs, paginate the jobs endpoint too.
Identify the first execution step by job: Format, Build apps, Backend tests,
Frontend tests, Verify packed packages with MongoDB drivers 6 and 7, Test built
Dashboard with MongoDB and selected host, or Check results.

The snapshot's newest run is [44076452446](https://github.com/ueberBrot/monque/actions/runs/44076452446).
The main-branch reference is [44076299870](https://github.com/ueberBrot/monque/actions/runs/44076299870).
Record event, commit, cache state, and workflow revision when comparing a new run;
one PR run cannot establish a new p50 or p95.

## Test-selection boundary

At audit time, the active Main Branch Protection ruleset requires CI Gate on an
up-to-date branch and has no bypass actors. The repository is personally owned;
[GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) require eligible organization ownership. Full runtime PR
checks remain required, with the existing explicit docs-only exemption. Queue
rollout and affected-only required CI are outside this change.

A supplemental affected-test pass is also deferred: it would repeat units before
the full suite and needs evidence that earlier failure feedback justifies the
additional work. Local incremental unit tasks provide optional edit-loop feedback.

## Exact exploratory sample

All sampled manifests pin Vite+ 1.6.0, Vitest 5.1.0, and Bun 1.4.4. Workflow and
lockfile columns are Git blob prefixes, not commit prefixes. Run links expose the
full commit and job timestamps needed to reproduce each observation.

| Run                                                                         | Event        | Head     | Workflow | Lockfile |
| --------------------------------------------------------------------------- | ------------ | -------- | -------- | -------- |
| [44076452446](https://github.com/ueberBrot/monque/actions/runs/44076452446) | pull_request | d648923d | c05cf8ab | b42db5aa |
| [44076299870](https://github.com/ueberBrot/monque/actions/runs/44076299870) | push         | aa852c36 | c05cf8ab | ebaff82e |
| [44075379705](https://github.com/ueberBrot/monque/actions/runs/44075379705) | pull_request | b7fc3d40 | c05cf8ab | ebaff82e |
| [44068686525](https://github.com/ueberBrot/monque/actions/runs/44068686525) | pull_request | 17456b0a | c05cf8ab | ebaff82e |
| [44066803948](https://github.com/ueberBrot/monque/actions/runs/44066803948) | pull_request | c53d44f7 | c05cf8ab | c8d7b4cf |
| [44063787776](https://github.com/ueberBrot/monque/actions/runs/44063787776) | pull_request | 10fcfd3b | c05cf8ab | b42db5aa |
| [44063589229](https://github.com/ueberBrot/monque/actions/runs/44063589229) | push         | f57ef182 | c05cf8ab | ebaff82e |
| [44062512281](https://github.com/ueberBrot/monque/actions/runs/44062512281) | pull_request | 6888ab74 | c05cf8ab | ebaff82e |
| [44061372470](https://github.com/ueberBrot/monque/actions/runs/44061372470) | pull_request | df63e2db | c05cf8ab | e0e68903 |
| [44061231811](https://github.com/ueberBrot/monque/actions/runs/44061231811) | push         | 7e83d7c0 | c05cf8ab | f4f27e70 |
| [44060262619](https://github.com/ueberBrot/monque/actions/runs/44060262619) | pull_request | 832b7d5d | c05cf8ab | f4f27e70 |
| [44056810689](https://github.com/ueberBrot/monque/actions/runs/44056810689) | pull_request | 8936fb7f | c05cf8ab | f4f27e70 |
| [44052825324](https://github.com/ueberBrot/monque/actions/runs/44052825324) | pull_request | ad03a678 | c05cf8ab | f4f27e70 |
| [44032006601](https://github.com/ueberBrot/monque/actions/runs/44032006601) | pull_request | d92f55ec | 388231ef | be69264d |
| [44015097437](https://github.com/ueberBrot/monque/actions/runs/44015097437) | pull_request | 7bab59eb | 388231ef | be69264d |
| [44011391763](https://github.com/ueberBrot/monque/actions/runs/44011391763) | pull_request | d448da09 | 388231ef | be69264d |
| [44003899954](https://github.com/ueberBrot/monque/actions/runs/44003899954) | pull_request | 05c80bbc | 15c556af | be69264d |
