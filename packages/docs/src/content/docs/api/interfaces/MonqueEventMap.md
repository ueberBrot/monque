---
editUrl: false
next: false
prev: false
title: "MonqueEventMap"
---

Defined in: [packages/core/src/events/types.ts:6](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L6)

Event payloads for Monque lifecycle events.

## Properties

### changestream:closed

```ts
changestream:closed: undefined;
```

Defined in: [packages/core/src/events/types.ts:61](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L61)

Emitted when the change stream is closed.

***

### changestream:connected

```ts
changestream:connected: undefined;
```

Defined in: [packages/core/src/events/types.ts:49](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L49)

Emitted when the change stream is successfully connected.

***

### changestream:error

```ts
changestream:error: object;
```

Defined in: [packages/core/src/events/types.ts:54](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L54)

Emitted when a change stream error occurs.

#### error

```ts
error: Error;
```

***

### changestream:fallback

```ts
changestream:fallback: object;
```

Defined in: [packages/core/src/events/types.ts:66](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L66)

Emitted when falling back from change streams to polling-only mode.

#### reason

```ts
reason: string;
```

***

### job:complete

```ts
job:complete: object;
```

Defined in: [packages/core/src/events/types.ts:15](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L15)

Emitted when a job finishes successfully.

#### duration

```ts
duration: number;
```

Processing duration in milliseconds

#### job

```ts
job: Job;
```

***

### job:error

```ts
job:error: object;
```

Defined in: [packages/core/src/events/types.ts:34](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L34)

Emitted for unexpected errors during processing.

#### error

```ts
error: Error;
```

#### job?

```ts
optional job: Job<unknown>;
```

***

### job:fail

```ts
job:fail: object;
```

Defined in: [packages/core/src/events/types.ts:24](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L24)

Emitted when a job fails (may retry).

#### error

```ts
error: Error;
```

#### job

```ts
job: Job;
```

#### willRetry

```ts
willRetry: boolean;
```

Whether the job will be retried

***

### job:start

```ts
job:start: Job;
```

Defined in: [packages/core/src/events/types.ts:10](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L10)

Emitted when a job begins processing.

***

### stale:recovered

```ts
stale:recovered: object;
```

Defined in: [packages/core/src/events/types.ts:42](https://github.com/ueberBrot/monque/blob/main/packages/core/src/events/types.ts#L42)

Emitted when stale jobs are recovered on startup.

#### count

```ts
count: number;
```
