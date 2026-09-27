---
'@monque/core': patch
---

Avoid overlapping heartbeat maintenance calls when MongoDB responds more slowly than the heartbeat interval. Later heartbeats continue after a failed call.
