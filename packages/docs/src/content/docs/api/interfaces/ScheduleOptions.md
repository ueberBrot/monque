---
editUrl: false
next: false
prev: false
title: "ScheduleOptions"
---

Defined in: [packages/core/src/jobs/types.ts:159](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/types.ts#L159)

Options for scheduling a recurring job.

## Example

```typescript
await monque. schedule('0 * * * *', 'hourly-cleanup', { dir: '/tmp' }, {
  uniqueKey: 'hourly-cleanup-job',
});
```

## Properties

### uniqueKey?

```ts
optional uniqueKey: string;
```

Defined in: [packages/core/src/jobs/types.ts:164](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/types.ts#L164)

Deduplication key. If a job with this key is already pending or processing,
the schedule operation will not create a duplicate.
