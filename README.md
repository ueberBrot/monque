<p align="center">
  <img src="assets/logo-with-text.svg" alt="Monque" width="800" />
</p>

<p align="center">
  <a href="https://github.com/ueberbrot/monque/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/ueberbrot/monque/ci.yml?branch=main&style=for-the-badge&label=CI" alt="CI status" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/ueberbrot/monque?style=for-the-badge&label=LICENSE" alt="ISC license" />
  </a>
</p>

Monque runs background jobs in Node.js applications using MongoDB. Schedule work, register
workers, and let multiple processes share a jobs collection. Add the Management API and
Dashboard to inspect jobs and control processing from your application.

[Documentation](https://ueberBrot.github.io/monque/) ·
[Getting started](https://ueberBrot.github.io/monque/getting-started/quick-start/) ·
[Dashboard setup](https://ueberBrot.github.io/monque/dashboard/express/)

## Packages

Start with `@monque/core`. The other packages add framework integration, an HTTP API,
or a browser dashboard around the same scheduler.

| Package                                                     | Use it to                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [@monque/core](./packages/core)                             | Enqueue jobs, register workers, and manage scheduling and execution.                          |
| [@monque/tsed](./packages/tsed)                             | Register workers with Ts.ED decorators and manage the scheduler through dependency injection. |
| [@monque/management](./packages/management)                 | Expose job queries and actions through an HTTP contract with authorization hooks and OpenAPI. |
| [@monque/management-express](./packages/management-express) | Mount the Management API in an Express application.                                           |
| [@monque/dashboard](./packages/dashboard)                   | Use the prebuilt browser dashboard assets in a server integration.                            |
| [@monque/dashboard-express](./packages/dashboard-express)   | Serve the Dashboard from Express without a frontend build.                                    |

For Express, mount both `@monque/management-express` and `@monque/dashboard-express`.
The first exposes your scheduler; the second serves the UI. Protect both with your
application's authentication middleware. See the [complete setup](https://ueberBrot.github.io/monque/dashboard/express/).

## Working with jobs

- **Schedule work:** enqueue immediately, choose a future date, or use a recurring cron
  schedule with a timezone. Submit batches with `enqueueMany()` or include job writes
  in your own MongoDB transaction.
- **Control execution:** set worker and instance concurrency, configure retries per worker,
  and pause or resume local processing without interrupting running jobs.
- **Validate payloads:** pass a Standard Schema compatible validator to a worker.
  The handler receives validated output, including schema transformations.
- **Recover interrupted work:** atomic claims coordinate workers across processes.
  Optional renewable leases keep long-running jobs claimed and let surviving schedulers
  recover abandoned work. Change Streams wake workers, with polling as a fallback.
- **Inspect and operate:** browse jobs and worker policies, inspect failures and lease
  deadlines, and retry, cancel, reschedule, or delete jobs through the API or Dashboard.

Retries and recovery can run a job more than once. Keep handlers idempotent; claim
ownership protects stored job state, but cannot undo a handler's external side effects.
Pause and resume controls apply only to the scheduler instance receiving the request.

## Quick start

Install core and its MongoDB peer dependency:

```bash
bun add @monque/core mongodb
```

```typescript
import { Monque } from "@monque/core";
import { MongoClient } from "mongodb";

const client = await MongoClient.connect("mongodb://localhost:27017");
const monque = new Monque(client.db("myapp"));
await monque.initialize();

monque.register<{ message: string }>("log-message", async (job) => {
  console.log(job.data.message);
});
monque.start();

await monque.enqueue("log-message", { message: "Hello from Monque" });

async function shutdown() {
  await monque.stop();
  await client.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
```

See the guides for [scheduling and transactions](https://ueberBrot.github.io/monque/core-concepts/jobs/),
[workers and validation](https://ueberBrot.github.io/monque/core-concepts/workers/),
[retry settings](https://ueberBrot.github.io/monque/core-concepts/retry/), and
[renewable leases](https://ueberBrot.github.io/monque/advanced/heartbeat/).

## Requirements

- Node.js 22.12 or newer.
- MongoDB 4.4 or newer. Change Streams and transactions require a replica set or sharded cluster.
  Workers can use polling with a standalone MongoDB server.

## Development

Install the [Vite+ global CLI](https://viteplus.dev/guide/global-cli), then use `vp` for repository commands. It selects Bun from [package.json](./package.json) and Node from [.node-version](./.node-version). Integration tests need Docker for MongoDB Testcontainers.

```bash
vp install
vp run check
vp run test
vp run build
```

Package tasks live in each `vite.config.ts`. From a package directory, use
`vp run test:unit`; from the root, use `vp run @monque/core#test:unit`.
`vp run check` fixes formatting/lint and checks types; CI uses read-only checks.
Vite+ installs the staged-check hook on `vp install`. Library builds retain ESM and
CommonJS outputs and strict export/declaration validation.

Use `vp fmt` to format, `vp fmt --check` to verify formatting, and `vp lint --deny-warnings`
to lint. `vp run check` also builds required dependencies and checks every workspace;
bare `vp check` runs formatting and lint checks directly. Run `vp run` to browse available tasks.
Root scripts retain only shared workflows and hook setup. Without the global CLI,
install dependencies with Bun and prefix commands with `bun x`, for example `bun x vp fmt`.

Dashboard source also uses `@shadcn/lint` to catch unknown Tailwind classes through the
same `vp lint` command. It covers `packages/dashboard/src` and `apps/dashboard-dev/src`,
excluding generated routes and imported `components/ui` primitives. Both use the dashboard theme.

Update the bundled toolchain with `vp migrate --no-interactive --no-agent --no-editor --no-hooks`;
Vite+ and its Vite/Vitest aliases must be updated together in the Bun catalog.

The documentation site lives in [apps/docs](./apps/docs). Run `vp run @monque/docs#dev` to work on it locally.

## Inspired by

- [Agenda](https://github.com/agenda/agenda) and [Pulse](https://github.com/pulsecron/pulse): MongoDB job scheduling.
- [BullMQ](https://github.com/taskforcesh/bullmq): Redis job queues.
- [pg-boss](https://github.com/timgit/pg-boss) and [Graphile Worker](https://github.com/graphile/worker): PostgreSQL job queues.

## License

[ISC](./LICENSE) © Maurice de Bruyn
