---
"@monque/core": minor
---

Add optional OpenTelemetry tracing through `@monque/core/opentelemetry`, using the application's provider. Operation spans inherit the active application parent, and ordinary Workers expose active tracing context for downstream instrumentation. See the OpenTelemetry integration guide for setup and ownership.
