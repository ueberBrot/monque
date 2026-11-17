# Scheduler and monitoring baseline

Run from the repository root with Bun and the pinned dependencies installed. Use a
local MongoDB server that permits creating and dropping databases and reading `buildInfo`
and `hello`. The harness creates a random `monque_benchmark_*` database, removes it in
`finally`, disposes its Scheduler Instances, and never selects the database named in the connection URI. Other databases
are untouched. A killed process can leave its generated database behind; its name appears
in MongoDB command logs. Do not point the harness at a production server.

```sh
vp run --filter @monque/core --filter @monque/management build
MONQUE_BENCH_URI='mongodb://127.0.0.1:27017/?directConnection=true' \
  vp run @monque/verification#benchmark > /tmp/monque-baseline.json
MONQUE_BENCH_URI='mongodb://127.0.0.1:27017/?directConnection=true' \
  vp run test:benchmark
```

An optional JSON file overrides workload defaults:

```sh
MONQUE_BENCH_URI='mongodb://127.0.0.1:27017/?directConnection=true' \
  vp run @monque/verification#benchmark /tmp/workload.json > /tmp/monque-baseline.json
```

```json
{
  "jobs": 1000,
  "history": 100000,
  "warmup": 1,
  "repetitions": 3,
  "instances": 1,
  "workerConcurrency": 10,
  "instanceConcurrency": 10,
  "payloadBytes": 256,
  "pollIntervalMs": 100,
  "pollingRounds": 6,
  "pollingIntervalMs": 1000
}
```

The output records resolved options, revision, dirty status, host/runtime information,
MongoDB build and topology, setup time, dataset preparation time, and each repetition.
Keep raw reports outside the repository. [baseline.md](baseline.md) records measured results.

## Measurements

Initialization creates the normal scheduler indexes. Each processing repetition starts
with an empty collection. One producer calls public `enqueue` sequentially; all configured
Scheduler Instances share that collection and register one no-op Promise Worker.
All Scheduler Instances run in one process.
The Worker records a monotonic timestamp at entry. Enqueue-to-start latency begins just
before `enqueue`, so it includes the write and queue wait. Intake throughput ends after
the last acknowledged enqueue. Processing throughput ends after every public completion
event, with up to 5 ms of observation delay. Counts and starts must match the workload.
A 60-second drain timeout detects a stalled run; no throughput or latency threshold is
used in tests or CI. Change streams use Monque's normal automatic behavior; fallback and
safety polling both use `pollIntervalMs`.

After processing stops, dataset preparation inserts exactly `history` completed Jobs in
batches of 1,000. Ten Job Names share a fixed timestamp and a payload string of
`payloadBytes` ASCII bytes. ObjectIds break timestamp ties. These synthetic terminal
records avoid timing 100,000 Worker executions as setup. Preparation and warmup are
excluded from measured repetitions. Each scenario discards `warmup` whole repetitions.
Caches and connections remain warm across repetitions.

Polling calls the public Management OpenAPI handler with Fetch Requests, reads each
response body, and requires HTTP 200. It models a visible Jobs page plus Queue View and
health monitoring: summary Jobs (50 rows, createdAt descending) each tick, capabilities
every sixth tick, Queue Views and health every third tick. This follows the cadences in
`packages/dashboard/src/routes/{jobs,queue-views,health}.tsx`. The combined request mix
is sequential, with `pollingIntervalMs` between rounds. It omits browser jitter, hidden-tab
pauses, network transport, authentication middleware, and rendering. Reported latency
covers handler execution and body serialization/consumption, not browser rendering.
Response sizes are uncompressed UTF-8 body bytes. Per-path summaries keep different
endpoint costs separate; percentiles use the nearest-rank method.

Database operations mean driver `commandStarted` events for the generated database,
including `getMore`, failed commands, idle polling, and concurrent discovery. They are
not documents scanned, storage operations, or server CPU time. Commands are attributed
when started; an in-flight command can finish in the next phase. The JSON includes
command names and per-Job counts. Initialization, history insertion, and cleanup are
outside the measured windows. Monitoring uses stopped instances, so its counts exclude
processing traffic. Management caches can eliminate database commands on repeated reads.

Comparisons need the same revision, runtime, MongoDB configuration, data shape, and
workload. Shared host load, Docker resources, command monitoring, and the in-process
measurement add overhead. These results establish observations for follow-up profiling;
they do not establish a production capacity guarantee.
