---
editUrl: false
next: false
prev: false
title: "validateCronExpression"
---

```ts
function validateCronExpression(expression): void;
```

Defined in: [packages/core/src/shared/utils/cron.ts:50](https://github.com/ueberBrot/monque/blob/main/packages/core/src/shared/utils/cron.ts#L50)

Validate a cron expression without calculating the next run date.

## Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `expression` | `string` | A 5-field cron expression |

## Returns

`void`

## Throws

If the cron expression is invalid

## Example

```typescript
validateCronExpression('0 9 * * 1'); // Throws if invalid
```
