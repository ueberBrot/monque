---
editUrl: false
next: false
prev: false
title: "JobStatusType"
---

```ts
type JobStatusType = typeof JobStatus[keyof typeof JobStatus];
```

Defined in: [packages/core/src/jobs/types.ts:33](https://github.com/ueberBrot/monque/blob/main/packages/core/src/jobs/types.ts#L33)

Union type of all possible job status values: `'pending' | 'processing' | 'completed' | 'failed'`
