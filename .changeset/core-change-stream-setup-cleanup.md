---
"@monque/core": patch
---

Close change-stream cursors when setup fails, including when a connected listener throws. Stop notifications from failed cursors while preserving replacement cursors opened by callbacks.
