---
editUrl: false
next: false
prev: false
title: "WorkerOptions"
---

Defined in: [packages/core/src/workers/types.ts:13](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/workers/types.ts#L13)

Options for registering a worker.

## Example

```typescript
monque.worker('send-email', emailHandler, {
  concurrency: 3,
});
```

## Properties

### concurrency?

```ts
optional concurrency: number;
```

Defined in: [packages/core/src/workers/types.ts:18](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/workers/types.ts#L18)

Number of concurrent jobs this worker can process.

#### Default

```ts
5 (uses defaultConcurrency from MonqueOptions)
```

***

### replace?

```ts
optional replace: boolean;
```

Defined in: [packages/core/src/workers/types.ts:25](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/workers/types.ts#L25)

Allow replacing an existing worker for the same job name.
If false (default) and a worker already exists, throws WorkerRegistrationError.

#### Default

```ts
false
```
