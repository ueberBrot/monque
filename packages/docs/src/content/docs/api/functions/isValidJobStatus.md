---
editUrl: false
next: false
prev: false
title: "isValidJobStatus"
---

```ts
function isValidJobStatus(value): value is JobStatusType;
```

Defined in: [packages/core/src/jobs/guards.ts:73](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/guards.ts#L73)

Type guard to check if a value is a valid job status.

Validates that a value is one of the four valid job statuses: `'pending'`,
`'processing'`, `'completed'`, or `'failed'`. Useful for runtime validation
of user input or external data.

## Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `value` | `unknown` | The value to check |

## Returns

`value is JobStatusType`

`true` if the value is a valid `JobStatusType`, narrowing the type

## Examples

```typescript
function filterByStatus(status: string) {
  if (!isValidJobStatus(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  // TypeScript knows status is JobStatusType here
  return db.jobs.find({ status });
}
```

```typescript
const statusFromApi = externalData.status;

if (isValidJobStatus(statusFromApi)) {
  job.status = statusFromApi;
} else {
  job.status = JobStatus.PENDING;
}
```
