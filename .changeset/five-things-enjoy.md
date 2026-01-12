---
"@monque/core": minor
---

### API Rename: `worker()` → `register()`

The public method for registering job handlers has been renamed from `worker()` to `register()` for improved API clarity.

**Before:**
```typescript
monque.worker('send-email', async (job) => {
  await sendEmail(job.data);
});
```

**After:**
```typescript
monque.register('send-email', async (job) => {
  await sendEmail(job.data);
});
```

This is a **breaking change** for users upgrading from earlier versions. Update all `monque.worker()` calls to `monque.register()`.
