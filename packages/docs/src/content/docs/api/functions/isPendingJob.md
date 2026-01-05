---
editUrl: false
next: false
prev: false
title: "isPendingJob"
---

```ts
function isPendingJob<T>(job): boolean;
```

Defined in: [packages/core/src/jobs/guards.ts:101](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/guards.ts#L101)

Type guard to check if a job is in pending status.

A convenience helper for checking if a job is waiting to be processed.
Equivalent to `job.status === JobStatus.PENDING` but with better semantics.

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

`true` if the job status is `'pending'`

## Examples

```typescript
const jobs = await monque.getJobs();
const pendingJobs = jobs.filter(isPendingJob);
console.log(`${pendingJobs.length} jobs waiting to be processed`);
```

```typescript
if (isPendingJob(job)) {
  await monque.now(job.name, job.data);
}
```
