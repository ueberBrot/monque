---
editUrl: false
next: false
prev: false
title: "GetJobsFilter"
---

Defined in: [packages/core/src/jobs/types.ts:188](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L188)

Filter options for querying jobs.

Use with `monque.getJobs()` to filter jobs by name, status, or limit results.

## Example

```typescript
// Get all pending email jobs
const pendingEmails = await monque.getJobs({
  name: 'send-email',
  status: JobStatus.PENDING,
});

// Get all failed or completed jobs (paginated)
const finishedJobs = await monque.getJobs({
  status: [JobStatus.COMPLETED, JobStatus.FAILED],
  limit: 50,
  skip: 100,
});
```

## Properties

### limit?

```ts
optional limit: number;
```

Defined in: [packages/core/src/jobs/types.ts:196](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L196)

Maximum number of jobs to return (default: 100)

***

### name?

```ts
optional name: string;
```

Defined in: [packages/core/src/jobs/types.ts:190](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L190)

Filter by job type name

***

### skip?

```ts
optional skip: number;
```

Defined in: [packages/core/src/jobs/types.ts:199](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L199)

Number of jobs to skip for pagination

***

### status?

```ts
optional status: 
  | JobStatusType
  | JobStatusType[];
```

Defined in: [packages/core/src/jobs/types.ts:193](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L193)

Filter by status (single or multiple)
