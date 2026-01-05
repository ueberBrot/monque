---
editUrl: false
next: false
prev: false
title: "Job"
---

Defined in: [packages/core/src/jobs/types.ts:59](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L59)

Represents a job in the Monque queue.

## Example

```typescript
interface EmailJobData {
  to: string;
  subject: string;
  template: string;
}

const job: Job<EmailJobData> = {
  name: 'send-email',
  data: { to: 'user@example.com', subject: 'Welcome!', template: 'welcome' },
  status: JobStatus.PENDING,
  nextRunAt: new Date(),
  failCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};
```

## Type Parameters

| Type Parameter | Default type | Description |
| ------ | ------ | ------ |
| `T` | `unknown` | The type of the job's data payload |

## Properties

### \_id?

```ts
optional _id: ObjectId;
```

Defined in: [packages/core/src/jobs/types.ts:61](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L61)

MongoDB document identifier

***

### claimedBy?

```ts
optional claimedBy: string | null;
```

Defined in: [packages/core/src/jobs/types.ts:83](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L83)

Unique identifier of the scheduler instance that claimed this job.
Used for atomic claim pattern - ensures only one instance processes each job.
Set when a job is claimed, cleared when job completes or fails.

***

### createdAt

```ts
createdAt: Date;
```

Defined in: [packages/core/src/jobs/types.ts:111](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L111)

Job creation timestamp

***

### data

```ts
data: T;
```

Defined in: [packages/core/src/jobs/types.ts:67](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L67)

Job payload - must be JSON-serializable

***

### failCount

```ts
failCount: number;
```

Defined in: [packages/core/src/jobs/types.ts:99](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L99)

Number of failed attempts

***

### failReason?

```ts
optional failReason: string;
```

Defined in: [packages/core/src/jobs/types.ts:102](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L102)

Last failure error message

***

### heartbeatInterval?

```ts
optional heartbeatInterval: number;
```

Defined in: [packages/core/src/jobs/types.ts:96](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L96)

Heartbeat interval in milliseconds for this job.
Stored on the job to allow recovery logic to use the correct timeout.

***

### lastHeartbeat?

```ts
optional lastHeartbeat: Date | null;
```

Defined in: [packages/core/src/jobs/types.ts:90](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L90)

Timestamp of the last heartbeat update for this job.
Used to detect stale jobs when a scheduler instance crashes without releasing.
Updated periodically while job is being processed.

***

### lockedAt?

```ts
optional lockedAt: Date | null;
```

Defined in: [packages/core/src/jobs/types.ts:76](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L76)

Timestamp when job was locked for processing

***

### name

```ts
name: string;
```

Defined in: [packages/core/src/jobs/types.ts:64](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L64)

Job type identifier, matches worker registration

***

### nextRunAt

```ts
nextRunAt: Date;
```

Defined in: [packages/core/src/jobs/types.ts:73](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L73)

When the job should be processed

***

### repeatInterval?

```ts
optional repeatInterval: string;
```

Defined in: [packages/core/src/jobs/types.ts:105](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L105)

Cron expression for recurring jobs

***

### status

```ts
status: JobStatusType;
```

Defined in: [packages/core/src/jobs/types.ts:70](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L70)

Current lifecycle state

***

### uniqueKey?

```ts
optional uniqueKey: string;
```

Defined in: [packages/core/src/jobs/types.ts:108](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L108)

Deduplication key to prevent duplicate jobs

***

### updatedAt

```ts
updatedAt: Date;
```

Defined in: [packages/core/src/jobs/types.ts:114](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L114)

Last modification timestamp
