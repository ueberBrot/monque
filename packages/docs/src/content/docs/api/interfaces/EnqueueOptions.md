---
editUrl: false
next: false
prev: false
title: "EnqueueOptions"
---

Defined in: [packages/core/src/jobs/types.ts:136](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/types.ts#L136)

Options for enqueueing a job.

## Example

```typescript
await monque.enqueue('sync-user', { userId: '123' }, {
  uniqueKey: 'sync-user-123',
  runAt: new Date(Date.now() + 5000), // Run in 5 seconds
});
```

## Properties

### runAt?

```ts
optional runAt: Date;
```

Defined in: [packages/core/src/jobs/types.ts:146](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/types.ts#L146)

When the job should be processed. Defaults to immediately (new Date()).

***

### uniqueKey?

```ts
optional uniqueKey: string;
```

Defined in: [packages/core/src/jobs/types.ts:141](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/types.ts#L141)

Deduplication key. If a job with this key is already pending or processing,
the enqueue operation will not create a duplicate.
