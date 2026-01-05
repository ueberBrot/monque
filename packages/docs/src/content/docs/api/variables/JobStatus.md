---
editUrl: false
next: false
prev: false
title: "JobStatus"
---

```ts
const JobStatus: object;
```

Defined in: [packages/core/src/jobs/types.ts:19](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L19)

Represents the lifecycle states of a job in the queue.

Jobs transition through states as follows:
- PENDING → PROCESSING (when picked up by a worker)
- PROCESSING → COMPLETED (on success)
- PROCESSING → PENDING (on failure, if retries remain)
- PROCESSING → FAILED (on failure, after max retries exhausted)

## Type Declaration

### COMPLETED

```ts
readonly COMPLETED: "completed" = 'completed';
```

Job completed successfully

### FAILED

```ts
readonly FAILED: "failed" = 'failed';
```

Job permanently failed after exhausting all retry attempts

### PENDING

```ts
readonly PENDING: "pending" = 'pending';
```

Job is waiting to be picked up by a worker

### PROCESSING

```ts
readonly PROCESSING: "processing" = 'processing';
```

Job is currently being executed by a worker

## Example

```typescript
if (job.status === JobStatus.PENDING) {
  // job is waiting to be picked up
}
```
