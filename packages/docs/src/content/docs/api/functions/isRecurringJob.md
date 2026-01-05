---
editUrl: false
next: false
prev: false
title: "isRecurringJob"
---

```ts
function isRecurringJob<T>(job): boolean;
```

Defined in: [packages/core/src/jobs/guards.ts:197](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/guards.ts#L197)

Type guard to check if a job is a recurring scheduled job.

A recurring job has a `repeatInterval` cron expression and will be automatically
rescheduled after each successful completion.

## Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` | The type of the job's data payload |

## Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `job` | [`Job`](/api/interfaces/job/)\<`T`\> | The job to check |

## Returns

`boolean`

`true` if the job has a `repeatInterval` defined

## Examples

```typescript
const jobs = await monque.getJobs();
const recurringJobs = jobs.filter(isRecurringJob);
console.log(`${recurringJobs.length} jobs will repeat automatically`);
```

```typescript
if (!isRecurringJob(job) && isCompletedJob(job)) {
  // Safe to delete one-time completed jobs
  await deleteJob(job._id);
}
```
