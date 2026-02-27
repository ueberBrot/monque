---
'@monque/core': patch
---

Extract `documentToPersistedJob` mapper into a standalone function for testability and add round-trip unit tests to guard against silent field-dropping when new Job fields are added.
