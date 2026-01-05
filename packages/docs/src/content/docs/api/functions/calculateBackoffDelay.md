---
editUrl: false
next: false
prev: false
title: "calculateBackoffDelay"
---

```ts
function calculateBackoffDelay(
   failCount, 
   baseInterval, 
   maxDelay?): number;
```

Defined in: [packages/core/src/shared/utils/backoff.ts:54](https://github.com/ueberBrot/monque/blob/main/packages/core/src/shared/utils/backoff.ts#L54)

Calculate just the delay in milliseconds for a given fail count.

## Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `failCount` | `number` | `undefined` | Number of previous failed attempts |
| `baseInterval` | `number` | `DEFAULT_BASE_INTERVAL` | Base interval in milliseconds (default: 1000ms) |
| `maxDelay?` | `number` | `undefined` | Maximum delay in milliseconds (optional) |

## Returns

`number`

The delay in milliseconds
