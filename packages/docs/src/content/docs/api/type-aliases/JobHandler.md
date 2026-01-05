---
editUrl: false
next: false
prev: false
title: "JobHandler"
---

```ts
type JobHandler<T> = (job) => Promise<void> | void;
```

Defined in: [packages/core/src/jobs/types.ts:214](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/types.ts#L214)

Handler function signature for processing jobs.

## Type Parameters

| Type Parameter | Default type | Description |
| ------ | ------ | ------ |
| `T` | `unknown` | The type of the job's data payload |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `job` | [`Job`](/monque/api/interfaces/job/)\<`T`\> |

## Returns

`Promise`\<`void`\> \| `void`

## Example

```typescript
const emailHandler: JobHandler<EmailJobData> = async (job) => {
  await sendEmail(job.data.to, job.data.subject);
};
```
