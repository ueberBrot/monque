---
editUrl: false
next: false
prev: false
title: "PersistedJob"
---

```ts
type PersistedJob<T> = Job<T> & object;
```

Defined in: [packages/core/src/jobs/types.ts:123](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/jobs/types.ts#L123)

A job that has been persisted to MongoDB and has a guaranteed `_id`.
This is returned by `enqueue()`, `now()`, and `schedule()` methods.

## Type Declaration

### \_id

```ts
_id: ObjectId;
```

## Type Parameters

| Type Parameter | Default type | Description |
| ------ | ------ | ------ |
| `T` | `unknown` | The type of the job's data payload |
