---
editUrl: false
next: false
prev: false
title: "isPersistedJob"
---

```ts
function isPersistedJob<T>(job): job is PersistedJob<T>;
```

Defined in: [packages/core/src/jobs/guards.ts:37](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/guards.ts#L37)

Type guard to check if a job has been persisted to MongoDB.

A persisted job is guaranteed to have an `_id` field, which means it has been
successfully inserted into the database. This is useful when you need to ensure
a job can be updated or referenced by its ID.

## Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` | The type of the job's data payload |

## Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `job` | [`Job`](/monque/api/interfaces/job/)\<`T`\> | The job to check |

## Returns

`job is PersistedJob<T>`

`true` if the job has a valid `_id`, narrowing the type to `PersistedJob<T>`

## Examples

```typescript
const job: Job<EmailData> = await monque.enqueue('send-email', emailData);

if (isPersistedJob(job)) {
  // TypeScript knows job._id exists
  console.log(`Job ID: ${job._id.toString()}`);
}
```

```typescript
function logJobId(job: Job) {
  if (!isPersistedJob(job)) {
    console.log('Job not yet persisted');
    return;
  }
  // TypeScript knows job is PersistedJob here
  console.log(`Processing job ${job._id.toString()}`);
}
```
