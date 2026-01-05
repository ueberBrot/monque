---
editUrl: false
next: false
prev: false
title: "isProcessingJob"
---

```ts
function isProcessingJob<T>(job): boolean;
```

Defined in: [packages/core/src/jobs/guards.ts:122](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/guards.ts#L122)

Type guard to check if a job is currently being processed.

A convenience helper for checking if a job is actively running.
Equivalent to `job.status === JobStatus.PROCESSING` but with better semantics.

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

`true` if the job status is `'processing'`

## Example

```typescript
const jobs = await monque.getJobs();
const activeJobs = jobs.filter(isProcessingJob);
console.log(`${activeJobs.length} jobs currently running`);
```
