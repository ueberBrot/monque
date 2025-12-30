# @monque/tsed

Ts.ED framework integration for @monque/core with decorators and DI support.

## Installation

```bash
npm install @monque/tsed @monque/core @tsed/common @tsed/di mongodb
```

## Usage

(Coming soon in later phases)


Ts.ED framework integration for Monque job scheduler.

> 🚧 **Coming Soon** - This package is under development.

## Planned Features

- `@Job()` decorator for defining job handlers
- Automatic worker registration via DI
- `MonqueModule.forRoot()` for easy configuration
- Lifecycle integration (auto start/stop)

## Preview

```typescript
import { Module } from '@tsed/di';
import { MonqueModule } from '@monque/tsed';
import { Job } from '@monque/tsed';

@Module({
  imports: [
    MonqueModule.forRoot({
      connection: mongoDb,
      collectionName: 'jobs',
    }),
  ],
})
export class AppModule {}

@Job({ name: 'send-email' })
export class SendEmailJob {
  async handle(job: Job<EmailData>) {
    await sendEmail(job.data.to, job.data.subject);
  }
}
```

## License

ISC
