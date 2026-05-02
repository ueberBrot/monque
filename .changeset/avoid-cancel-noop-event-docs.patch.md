---
"@monque/docs": patch
---

Clarify cancellation event semantics in core docs.

- Update core management docs to state `job:cancelled` only emits on a pending→cancelled transition.
- Keep `cancelJob` docs consistent with idempotent no-op behavior for already-cancelled jobs.
