# ADR-0002: Change Streams With Polling Safety Net

Use change streams for low-latency worker wakeups, with polling as a fallback and
safety net because streams can be unavailable or disconnected. Keep local write
notifications independent of stream delivery. Correctness must remain possible
through polling alone.
