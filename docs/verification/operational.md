# Operational workload verification

Run this exercise before changing shared scheduling behavior. It combines a backlog,
new submissions, retries, and recurring work across separate Node.js processes. It
kills one process while that process holds a renewable claim, then pauses MongoDB long
enough to cause driver timeouts. Surviving schedulers must recover and finish the work.

## Run it

Install the pinned workspace dependencies, build core, and start Docker. The script
uses the built public core API and the MongoDB driver installed for core.

```sh
vp install --frozen-lockfile
vp run @monque/core#build
node scripts/verification/operational.mjs --output /tmp/monque-operational.json
```

The default run submits 240 finite Jobs over about 15 seconds. Half form the initial
backlog; the rest arrive throughout the run. Every tenth Job fails its first attempt.
Priorities cycle through -10, 0, and 10. Another 1,000 higher-priority Jobs remain
scheduled in the future. A recurring Job runs each second. Three processes start;
two survive the forced termination.

For a longer run, increase the submission period and the total time budget together:

```sh
node scripts/verification/operational.mjs \
  --jobs 1200 --workers 4 --duration-ms 30000 --future-jobs 5000 \
  --output /tmp/monque-operational-larger.json
```

Use `--help` for all options. `--job-ms` sets the simulated handler delay.
`--outage-ms` sets the database pause; its minimum exceeds the worker driver's
timeouts. `--timeout-ms` bounds setup, submission, the database pause, and drain waits, with a default
of 120 seconds. Driver operations and Docker commands also have timeouts. Cleanup
can take additional time; each Docker command has a 30-second limit.

The script creates a uniquely named `mongo:8.0.9` container and binds its random port
to localhost. It accepts no external database address. The container and its anonymous
volumes are removed after success, failure, SIGINT, or SIGTERM. Remaining workers are
killed during cleanup. SIGKILL of the parent or host failure can prevent cleanup;
remove any leftover container whose name begins with `monque-operational-`.

## What passes

All finite Jobs must reach completed status. Every deliberate first-attempt failure
must have a persisted retry and a successful outcome. The recurring Job must complete
at least twice. A surviving process must finish the killed process's Job, and every
future Job must remain pending. A driver command must fail during the actual database
pause. Unexpected worker exits fail the exercise.

Performance measurements have no pass thresholds. Run this on comparable hosts and
compare several samples before setting a regression budget.

## Measurements

- Throughput divides the finite Job count by elapsed time from initial submission to
  observed drain. The interval includes the outage and paced submissions. It excludes
  container setup and worker shutdown, and does not estimate maximum capacity.
- Pickup latency measures each work attempt's start event against its scheduled time.
  The JSON reports nearest-rank p50, p95, and maximum by priority. Retries use their new
  scheduled times; repeated attempts after recovery remain in the sample.
- Retry results distinguish persisted retried Jobs from observed failure events.
  Process termination or interrupted delivery can leave fewer events than persisted retries.
- Recovery measures the first completion after Docker resumes and completion of the
  killed process's Job after termination. The resume clock starts when the Docker
  command returns. The pause and recovery overlap.
- Memory is peak sampled resident memory for each process, sampled every 250 ms. It
  excludes MongoDB and the parent runner. Short peaks between samples can be missed.
- Command totals count the driver's success and failure events and sum their durations
  by command name. They include initialization, empty claims, polling, heartbeats, and
  recurring work. They exclude the producer. The killed process can lose up to one
  sample interval of totals.
- Query cost comes from explaining an observed claim command after the outage. The
  command retains its original due-time bound and runs against the remaining backlog.
  Explain executes no write. One sampled plan cannot establish all claim or discovery
  costs; existing priority query tests cover those cases separately.

## Recorded runs

Both runs passed on 8 October 2026 with Node.js 24.18.0, core 1.18.0, and MongoDB
8.0.9 on macOS arm64. The JSON artifacts record the source commit, settings, observed
errors, and full query plan. Other repository checks shared the host during these
runs, so their timings include that contention.

The checked-in results are [the default run](./operational-default.json) and
[the larger run](./operational-larger.json). Use their exact values when comparing
another run.

This exercise uses standalone MongoDB and polling. The expected change-stream
fallback errors appear in command totals. It does not cover replica-set elections,
network partitions between selected clients, disk loss, durable external side effects,
or a long memory soak. A database pause preserves its data and resumes the same
process. Repeated handler execution remains possible; completed Jobs alone cannot
prove exactly-once external effects.
