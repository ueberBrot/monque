# Recorded baseline

Measured 2026-11-16T09:00:38.607Z and 2026-11-16T09:01:13.852Z. The one-instance run
recorded revision `5602b7031b78369a4e17cece48c8a2949bf35b3e`; the two-instance run
recorded `47a094f58b5a7aeade820838ab856baa3f1555e3`. Both checkouts were clean and their
code trees are identical; the second revision merges rewritten integration history.

## Environment and commands

Apple M1 Max, 10 logical CPUs, 64 GiB host RAM, Darwin 25.6.0.
Bun 1.4.4 ran the harness (Node compatibility version v26.3.0);
the MongoDB driver was 7.8.0. Core and Management were built from the recorded revision.
MongoDB 8.3.11 ran as a local, writable single-node replica set
`local_dev_atlas` in Docker. Docker had 10 CPUs and
6,209,712,128 bytes RAM; the MongoDB container had no separate CPU or memory limit.
Image: `mongodb/mongodb-atlas-local:8.3.11`, digest
`sha256:3a8affee01fda1532d4083304bb6883f6fc0f1bf904c267d1785befa5391c58a`.
The storage engine was WiredTiger, with default read concern `local` and write
concern `majority` (`wtimeout: 0`). The driver used default pool settings.
The workstation and database server also hosted other applications.

```sh
vp run --filter @monque/core --filter @monque/management build
MONQUE_BENCH_URI='mongodb://127.0.0.1:27017/?directConnection=true' \
  bun scripts/benchmarks/run.mts > /tmp/monque-baseline.json
printf '{"instances":2}\n' > /tmp/monque-two-instances.json
MONQUE_BENCH_URI='mongodb://127.0.0.1:27017/?directConnection=true' \
  bun scripts/benchmarks/run.mts /tmp/monque-two-instances.json > /tmp/monque-baseline-two.json
```

All Scheduler Instances ran in one process. Both cases used 1,000 Jobs per processing
repetition, one producer, a 256-byte payload
string, Worker concurrency 10 and instance concurrency 10 per Scheduler Instance.
Each scenario discarded one warmup repetition and measured three repetitions.
Polling used six rounds at one-second intervals, with 100 ms fallback/safety polling
for processing. The monitoring dataset contained exactly 100,000 completed Jobs across
ten Job Names, with fixed timestamps and normal scheduler indexes. See
[measurement definitions](README.md#measurements) for request cadence, phase accounting,
and limitations.

## Processing

All measured repetitions completed 1,000 Jobs with 1,000 Worker starts. Latencies are
milliseconds; command counts include change-stream and discovery traffic.

| Instances | Repetition | Intake Jobs/s | Completed Jobs/s | Start p50 | Start p95 | Start p99 | Commands/Job |
| --------- | ---------- | ------------- | ---------------- | --------- | --------- | --------- | ------------ |
| 1         | 1          | 903.2         | 170.3            | 2379.36   | 4481.72   | 4743.56   | 4.738        |
| 1         | 2          | 746.9         | 173.6            | 2146.52   | 4214.85   | 4413.96   | 4.731        |
| 1         | 3          | 821.3         | 172.8            | 2336.04   | 4394.85   | 4565.31   | 4.774        |
| 2         | 1          | 694.0         | 348.3            | 769.87    | 1357.39   | 1419.23   | 5.974        |
| 2         | 2          | 594.0         | 346.9            | 587.12    | 1141.16   | 1201.58   | 5.961        |
| 2         | 3          | 671.9         | 354.9            | 658.27    | 1256.60   | 1323.73   | 6.080        |

| Instances | Initialization ms | History preparation ms |
| --------- | ----------------- | ---------------------- |
| 1         | 58.67             | 2331.05                |
| 2         | 51.99             | 2832.59                |

## Management polling

Each repetition made eleven requests: six summary Job lists, one capabilities request,
two Queue View requests and two health requests. Both cases observed seven database
commands per repetition: six `find` and one `aggregate`. Sizes were constant across
both cases: Jobs 15,617 bytes, capabilities 212, Queue Views 2,415, health 54.
The table retains each repetition's per-path p95 latency in milliseconds.
With these small sample counts, p95 and p99 are the maximum observed latency.

| Instances | Repetition | Jobs p95 | Capabilities p95 | Queue Views p95 | Health p95 |
| --------- | ---------- | -------- | ---------------- | --------------- | ---------- |
| 1         | 1          | 5.93     | 0.24             | 96.89           | 0.13       |
| 1         | 2          | 5.61     | 0.21             | 93.67           | 0.15       |
| 1         | 3          | 6.54     | 0.17             | 96.25           | 0.13       |
| 2         | 1          | 7.06     | 0.25             | 99.25           | 0.13       |
| 2         | 2          | 6.56     | 0.28             | 120.19          | 0.27       |
| 2         | 3          | 7.18     | 0.22             | 99.27           | 0.13       |

## Follow-up evidence

Queue View requests alternate between cached reads and an aggregation over completed
history. The aggregation requests take longer than summary Job lists in these runs.
Profile that aggregation with representative production data before changing indexes
or cache behavior. Extra Scheduler Instances also generate more `getMore` commands;
measure their server cost before treating command frequency as a bottleneck.

This small synthetic workload establishes no production bottleneck. It omits browser
rendering, network transport, retries, Worker I/O and concurrent production traffic.
Two instances also double configured Worker capacity, so the cases do not isolate
instance coordination overhead. No performance threshold or optimization follows from
these measurements. Raw JSON reports are kept outside the repository; the commands
above reproduce the workload, while numerical results depend on the environment.
