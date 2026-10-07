# @monque/core

Run background jobs in Node.js using MongoDB. Register workers, submit jobs, and share
one jobs collection across multiple processes. Monque uses the native MongoDB driver
and can reuse your application's connection.

## Installation

```bash
bun add @monque/core mongodb
```

Requires Node.js 22.12 or newer and MongoDB 4.4 or newer. Install `mongodb` within the
package's peer dependency range. Change Streams and transactions require a replica set
or sharded cluster; workers can use polling with standalone MongoDB.

## Run a worker

```typescript
import { Monque } from "@monque/core";
import { MongoClient } from "mongodb";

const client = await MongoClient.connect("mongodb://localhost:27017");
const monque = new Monque(client.db("myapp"));
await monque.initialize();

monque.register<{ message: string }>(
  "log-message",
  async (job) => {
    console.log(job.data.message);
  },
  { concurrency: 2, maxRetries: 3 },
);
monque.start();

await monque.enqueue("log-message", { message: "Hello from Monque" });
await monque.schedule(
  "0 9 * * *",
  "log-message",
  { message: "Daily reminder" },
  {
    timezone: "UTC",
    uniqueKey: "daily-reminder",
  },
);

async function shutdown() {
  await monque.stop();
  await client.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
```

Register a worker for each job name you submit. `stop()` waits for running handlers up to
`shutdownTimeout`; close your MongoDB client afterwards.

## Scheduling and execution

| Need                              | Use                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Immediate or delayed work         | `enqueue(name, data, { runAt?, uniqueKey?, priority? })`                                            |
| Immediate prioritized work        | `now(name, data, { priority?, session? })`                                                          |
| Recurring work                    | `schedule(cron, name, data, { timezone?, uniqueKey? })`                                             |
| Batch submission                  | `enqueueMany(jobs)` with per-job scheduling and unique keys                                         |
| Jobs committed with business data | Pass `{ session }` to `enqueue()`, `enqueueMany()`, or `schedule()` inside your MongoDB transaction |
| Payload validation                | Pass a Standard Schema compatible `schema` to `register()`                                          |
| Retry policy                      | Set `maxRetries`, `baseRetryInterval`, and `maxBackoffDelay` globally or per worker                 |
| Concurrency limits                | Set `workerConcurrency`, `instanceConcurrency`, or a worker's `concurrency`                         |
| Local processing control          | `pause(name?)`, `resume(name?)`, and `getProcessingState(name?)`                                    |

A unique key prevents duplicate pending or processing jobs with the same name. Once a
job is terminal, that key can be used again. Batch submission returns inserted and
deduplicated counts; without a transaction, a database error can leave partial writes.

Schema validation runs when a worker claims a job. Invalid input fails without invoking
the handler; transformed output is passed to the handler while stored input stays unchanged.

Retries and recovery can repeat a job. Handlers must tolerate repeated external side effects.
A pause prevents new local executions; running handlers and other scheduler instances continue.

### Job priority

`enqueue()` and `now()` accept signed safe-integer priorities. Omission means `0`, higher
numbers run first, and negative values mean below-normal work. Among due pending Jobs with
the same name, claims order by priority descending, then scheduled time and identifier
ascending. Future Jobs remain ineligible until their scheduled time. Priority preserves
fairness between Job Names and never interrupts running handlers; it does not guarantee
global start or completion order across instances. A continuous urgent backlog can starve
lower-priority work.

```typescript
await monque.enqueue("send-email", { kind: "digest" }, { priority: -10 });
await monque.now("send-email", { kind: "password-reset" }, { priority: 10 });
```

Duplicate submissions with an active unique key return the existing Job without changing
its priority. Public reads and lifecycle events expose effective numeric priority.
Initialization automatically sets missing priorities to `0`, preserving explicit values,
timestamps, lifecycle state, and ownership metadata, including with `skipIndexCreation`.
Upgrade all producers and claiming schedulers for uniform guarantees. Managed indexes need
both the priority claim index and the separate deadline index; see the
[priority and index deployment guidance](https://ueberBrot.github.io/monque/advanced/production-checklist/#10-ensure-index-permissions).

## Recovering interrupted work

By default, initialization recovers jobs whose absolute `lockTimeout` has expired.
Heartbeats do not extend that timeout. For long-running jobs and recovery without
restarting a surviving scheduler, set `leaseDuration` longer than `heartbeatInterval`.

Upgrade all schedulers sharing a collection before enabling leases. See
[heartbeat and recovery settings](https://ueberBrot.github.io/monque/advanced/heartbeat/)
for renewal, shutdown, and deployment behavior.

## Queries, actions, and events

Use `getJob()`, `getJobsWithCursor()`, `getQueueStats()`, and `getQueueViewSummaries()`
to inspect jobs and local worker activity. Job actions include retry, cancellation,
rescheduling, and deletion, with bulk methods for matching jobs.

```typescript
monque.on("job:complete", ({ job, duration }) => {
  console.log(`${job.name} completed in ${duration}ms`);
});
monque.on("job:fail", ({ job, error, willRetry }) => {
  console.error(job.name, error.message, { willRetry });
});
```

For HTTP access, use [@monque/management](../management). Express applications can add
[@monque/management-express](../management-express) and
[@monque/dashboard-express](../dashboard-express).

## Documentation

- [Jobs, batches, and transactions](https://ueberBrot.github.io/monque/core-concepts/jobs/)
- [Workers, validation, and pauses](https://ueberBrot.github.io/monque/core-concepts/workers/)
- [Retries](https://ueberBrot.github.io/monque/core-concepts/retry/)
- [Queries and actions](https://ueberBrot.github.io/monque/core-concepts/management/)
- [API reference](https://ueberBrot.github.io/monque/api/readme/)

## Development

From this package directory, run `vp run test:unit` for unit tests or `vp run test`
for the full suite. Integration tests use MongoDB Testcontainers and require Docker.
See the [repository README](../../README.md#development) for workspace commands.

## License

[ISC](./LICENSE)
