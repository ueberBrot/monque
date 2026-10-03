---
"@monque/core": patch
---

Expire cached query results using elapsed monotonic time so system clock corrections cannot prolong stale results or cause premature expiration.
