---
'@monque/core': minor
---

Add optional `leaseDuration` for long-running jobs. Heartbeats renew the claim using MongoDB's clock, including while handlers drain during graceful shutdown. Expired claims cannot renew or record a late result. Omit the option to retain absolute `lockTimeout` behavior, and upgrade every scheduler sharing the collection before enabling leases.
