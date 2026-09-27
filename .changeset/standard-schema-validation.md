---
'@monque/core': minor
---

Accept a Standard Schema compatible `schema` when registering a worker. Validate each claimed payload before invoking the handler, support asynchronous validators and transformed output, and fail invalid input once with structured `PayloadValidationError` issues. Stored input remains unchanged for retries and inspection.
