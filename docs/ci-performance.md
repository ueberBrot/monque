# CI performance snapshot: 2026-11-17

The audit covers the latest 150 CI runs available at 11:42:40 UTC on November 17,
from November 2 through November 17: 107 successful, 20 failed, and 23 cancelled.
Job and step timestamps come from GitHub's Actions API, using the latest attempt
of each run. Failed and cancelled runs remain in the census but are excluded from
the successful-runtime latency baseline.

## Baseline

The comparable cohort contains 17 successful runs with all six current Dashboard
E2E projects, including both host projects. Fourteen are pull requests. Older runs
have different job layouts and tooling; pooling them would obscure current costs.
This small cohort is a baseline, not a long-term service-level estimate.

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
all of these checks before starting. Producing build artifacts in a separate job
allows runtime jobs and quality checks to overlap. The tradeoff is one additional
runner setup; measure completion time and summed runner time after rollout.

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
up-to-date branch and has no merge queue. The full PR suite remains required.
Affected-test feedback may run earlier, but cannot replace the full suite under
this configuration. A future merge-queue rollout must first support `merge_group`
events and require full checks on the combined merge commit before narrowing PR
checks. Packed-consumer and Playwright checks need their own dependency policy.
