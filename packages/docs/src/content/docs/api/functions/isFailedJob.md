---
editUrl: false
next: false
prev: false
title: "isFailedJob"
---

```ts
function isFailedJob<T>(job): boolean;
```

Defined in: [packages/core/src/jobs/guards.ts:168](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/guards.ts#L168)

Type guard to check if a job has permanently failed.

A convenience helper for checking if a job exhausted all retries.
Equivalent to `job.status === JobStatus.FAILED` but with better semantics.

## Type Parameters

| Type Parameter | Description |
| ------ | ------ |
| `T` | The type of the job's data payload |

## Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `job` | [`Job`](/monque/api/interfaces/job/)\<`T`\> | The job to check |

## Returns

`boolean`

`true` if the job status is `'failed'`

## Example

```typescript
const jobs = await monque.getJobs();
const failedJobs = jobs.filter(isFailedJob);

for (const job of failedJobs) {
  console.error(`Job ${job.name} failed: ${job.failReason}`);
  await sendAlert(job);
}
```
