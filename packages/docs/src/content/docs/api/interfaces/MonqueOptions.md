---
editUrl: false
next: false
prev: false
title: "MonqueOptions"
---

Defined in: [packages/core/src/scheduler/types.ts:16](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L16)

Configuration options for the Monque scheduler.

## Example

```typescript
const monque = new Monque(db, {
  collectionName: 'jobs',
  pollInterval: 1000,
  maxRetries: 10,
  baseRetryInterval: 1000,
  shutdownTimeout: 30000,
  defaultConcurrency: 5,
});
```

## Properties

### baseRetryInterval?

```ts
optional baseRetryInterval: number;
```

Defined in: [packages/core/src/scheduler/types.ts:40](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L40)

Base interval in milliseconds for exponential backoff calculation.
Actual delay = 2^failCount * baseRetryInterval

#### Default

```ts
1000
```

***

### collectionName?

```ts
optional collectionName: string;
```

Defined in: [packages/core/src/scheduler/types.ts:21](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L21)

Name of the MongoDB collection for storing jobs.

#### Default

```ts
'monque_jobs'
```

***

### defaultConcurrency?

```ts
optional defaultConcurrency: number;
```

Defined in: [packages/core/src/scheduler/types.ts:59](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L59)

Default number of concurrent jobs per worker.

#### Default

```ts
5
```

***

### heartbeatInterval?

```ts
optional heartbeatInterval: number;
```

Defined in: [packages/core/src/scheduler/types.ts:83](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L83)

Interval in milliseconds for heartbeat updates during job processing.
The scheduler periodically updates lastHeartbeat for all jobs it is processing
to indicate liveness. Other instances use this to detect stale jobs.

#### Default

```ts
30000 (30 seconds)
```

***

### lockTimeout?

```ts
optional lockTimeout: number;
```

Defined in: [packages/core/src/scheduler/types.ts:67](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L67)

Maximum time in milliseconds a job can be in 'processing' status before
being considered stale and eligible for re-acquisition by other workers.
When using heartbeat-based detection, this should be at least 2-3x the heartbeatInterval.

#### Default

```ts
1800000 (30 minutes)
```

***

### maxBackoffDelay?

```ts
optional maxBackoffDelay: number;
```

Defined in: [packages/core/src/scheduler/types.ts:47](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L47)

Maximum delay in milliseconds for exponential backoff.
If calculated delay exceeds this value, it will be capped.

#### Default

```ts
undefined (no cap)
```

***

### maxRetries?

```ts
optional maxRetries: number;
```

Defined in: [packages/core/src/scheduler/types.ts:33](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L33)

Maximum number of retry attempts before marking a job as permanently failed.

#### Default

```ts
10
```

***

### pollInterval?

```ts
optional pollInterval: number;
```

Defined in: [packages/core/src/scheduler/types.ts:27](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L27)

Interval in milliseconds between polling for new jobs.

#### Default

```ts
1000
```

***

### recoverStaleJobs?

```ts
optional recoverStaleJobs: boolean;
```

Defined in: [packages/core/src/scheduler/types.ts:90](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L90)

Whether to recover stale processing jobs on scheduler startup.
When true, jobs with lockedAt older than lockTimeout will be reset to pending.

#### Default

```ts
true
```

***

### schedulerInstanceId?

```ts
optional schedulerInstanceId: string;
```

Defined in: [packages/core/src/scheduler/types.ts:75](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L75)

Unique identifier for this scheduler instance.
Used for atomic job claiming - each instance uses this ID to claim jobs.
Defaults to a randomly generated UUID v4.

#### Default

```ts
crypto.randomUUID()
```

***

### shutdownTimeout?

```ts
optional shutdownTimeout: number;
```

Defined in: [packages/core/src/scheduler/types.ts:53](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/scheduler/types.ts#L53)

Timeout in milliseconds for graceful shutdown.

#### Default

```ts
30000
```
