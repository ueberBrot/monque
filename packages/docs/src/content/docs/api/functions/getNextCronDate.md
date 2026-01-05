---
editUrl: false
next: false
prev: false
title: "getNextCronDate"
---

```ts
function getNextCronDate(expression, currentDate?): Date;
```

Defined in: [packages/core/src/shared/utils/cron.ts:28](https://github.com/ueberBrot/monque/blob/1f83b8316cb0fc85fdcc60acd7eba3a60dce443e/packages/core/src/shared/utils/cron.ts#L28)

Parse a cron expression and return the next scheduled run date.

## Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `expression` | `string` | A 5-field cron expression (minute hour day-of-month month day-of-week) or a predefined expression |
| `currentDate?` | `Date` | The reference date for calculating next run (default: now) |

## Returns

`Date`

The next scheduled run date

## Throws

If the cron expression is invalid

## Example

```typescript
// Every minute
const nextRun = getNextCronDate('* * * * *');

// Every day at midnight
const nextRun = getNextCronDate('0 0 * * *');

// Using predefined expression
const nextRun = getNextCronDate('@daily');

// Every Monday at 9am
const nextRun = getNextCronDate('0 9 * * 1');
```
