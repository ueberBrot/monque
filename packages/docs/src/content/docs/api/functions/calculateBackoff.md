---
editUrl: false
next: false
prev: false
title: "calculateBackoff"
---

```ts
function calculateBackoff(
   failCount, 
   baseInterval, 
   maxDelay?): Date;
```

Defined in: [packages/core/src/shared/utils/backoff.ts:32](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/shared/utils/backoff.ts#L32)

Calculate the next run time using exponential backoff.

Formula: nextRunAt = now + (2^failCount × baseInterval)

## Parameters

| Parameter | Type | Default value | Description |
| ------ | ------ | ------ | ------ |
| `failCount` | `number` | `undefined` | Number of previous failed attempts |
| `baseInterval` | `number` | `DEFAULT_BASE_INTERVAL` | Base interval in milliseconds (default: 1000ms) |
| `maxDelay?` | `number` | `undefined` | Maximum delay in milliseconds (optional) |

## Returns

`Date`

The next run date

## Example

```typescript
// First retry (failCount=1): 2^1 * 1000 = 2000ms delay
const nextRun = calculateBackoff(1);

// Second retry (failCount=2): 2^2 * 1000 = 4000ms delay
const nextRun = calculateBackoff(2);

// With custom base interval
const nextRun = calculateBackoff(3, 500); // 2^3 * 500 = 4000ms delay

// With max delay
const nextRun = calculateBackoff(10, 1000, 60000); // capped at 60000ms
```
