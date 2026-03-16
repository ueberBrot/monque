---
"@monque/core": patch
---

Set maxListeners to 20 on Monque EventEmitter to prevent memory leaks in long-running processes.
