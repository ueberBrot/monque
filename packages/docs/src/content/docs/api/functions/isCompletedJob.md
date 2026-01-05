---
editUrl: false
next: false
prev: false
title: "isCompletedJob"
---

```ts
function isCompletedJob<T>(job): boolean;
```

Defined in: [packages/core/src/jobs/guards.ts:143](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/guards.ts#L143)

Type guard to check if a job has completed successfully.

A convenience helper for checking if a job finished without errors.
Equivalent to `job.status === JobStatus.COMPLETED` but with better semantics.

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

`true` if the job status is `'completed'`

## Example

```typescript
const jobs = await monque.getJobs();
const completedJobs = jobs.filter(isCompletedJob);
console.log(`${completedJobs.length} jobs completed successfully`);
```
