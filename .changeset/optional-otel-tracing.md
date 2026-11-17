---
"@monque/core": minor
---

Add optional OpenTelemetry tracing through `@monque/core/opentelemetry` with the application's provider. Spans inherit the active parent. Ordinary Workers expose tracing context. Telemetry marks failed attempts as failures, including when retry scheduling succeeds. See the OpenTelemetry guide for ownership and setup.
