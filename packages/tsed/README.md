# @monque/tsed

Register Monque workers with Ts.ED decorators and inject `MonqueService` to submit or
inspect jobs. `MonqueModule` starts and stops the scheduler with your application.
Each handler execution gets its own context for request-scoped dependencies.

## Installation

In an existing Ts.ED application:

```bash
bun add @monque/tsed @monque/core mongodb
```

Requires `@monque/core` 1.15 or newer within version 1, plus the Ts.ED and MongoDB peers
listed in [package.json](./package.json). Mongoose is optional.

## Configure the database

Import `MonqueModule` and provide one of `db`, `dbFactory`, or `dbToken` in your
application's `monque` configuration. For an application using `@tsed/mongoose`:

```bash
bun add @tsed/mongoose mongoose
```

```typescript
import { MonqueModule } from '@monque/tsed';
import { Configuration } from '@tsed/di';
import { MongooseService } from '@tsed/mongoose';

@Configuration({
  imports: [MonqueModule],
  mongoose: [{ id: 'default', url: 'mongodb://localhost:27017/myapp' }],
  monque: {
    dbToken: MongooseService,
    mongooseConnectionId: 'default',
    workerConcurrency: 5,
  },
})
export class Server {}
```

Add this configuration to your existing Ts.ED server. `mongooseConnectionId` selects
which connection to use; `dbToken: MongooseService` provides that connection to Monque.

For the native driver, pass an already connected `Db` as `db`, return it from
`dbFactory`, or supply its DI provider through `dbToken`. Your application owns the
connection and must close it after the scheduler stops.

## Register workers

Ensure your application imports the job controller so Ts.ED can discover it:

```typescript
import type { Job as MonqueJob } from '@monque/core';
import { Cron, Job, JobController } from '@monque/tsed';

@JobController('logs')
export class LogJobs {
  @Job('message', { concurrency: 2, maxRetries: 3 })
  async writeMessage(job: MonqueJob<{ message: string }>) {
    console.log(job.data.message);
  }

  @Cron('0 9 * * *', { name: 'daily', timezone: 'UTC' })
  async daily() {
    console.log('Daily reminder');
  }
}
```

The registered job names are `logs.message` and `logs.daily`. `@Job()` accepts worker
concurrency, retry settings, and a Standard Schema compatible `schema`. `@Cron()`
accepts schedule options such as `timezone` and `uniqueKey`, plus a job-name override.
Scheduler settings such as `lockTimeout` and `leaseDuration` belong in `monque` configuration.

## Submit and inspect jobs

Inject `MonqueService` and use fully qualified job names:

```typescript
import { MonqueService } from '@monque/tsed';
import { Inject, Service } from '@tsed/di';

@Service()
export class LogService {
  constructor(@Inject(MonqueService) private readonly monque: MonqueService) {}

  async log(message: string) {
    return this.monque.enqueue('logs.message', { message });
  }
}
```

`MonqueService` also exposes batch submission, recurring schedules, cursor queries,
queue statistics, job actions, and local pause/resume controls. Pass `{ session }` to
`enqueue()`, `enqueueMany()`, or `schedule()` to join a transaction owned by your application.
The session must come from the same MongoDB client as the configured database.

Set `disableJobProcessing: true` in the `monque` configuration for a producer-only
application. It can submit and inspect jobs without registering or running workers.

For HTTP access, you can pass `MonqueService` as the Management API's `monque` option.
See [@monque/management](../management) for authorization and available operations.

## Documentation

- [Ts.ED setup and payload validation](https://ueberBrot.github.io/monque/integrations/tsed/)
- [Ts.ED API reference](https://ueberBrot.github.io/monque/api-tsed/readme/)
- [Core scheduling and execution](../core/README.md)

## Development

Run `bun run test` from this package directory. Integration tests use the repository's
MongoDB Testcontainers setup and require Docker. See the
[repository README](../../README.md#development) for workspace commands.

## License

[ISC](./LICENSE)
