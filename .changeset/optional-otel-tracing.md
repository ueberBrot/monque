---
"@monque/core": minor
---

Add optional OpenTelemetry tracing through `@monque/core/opentelemetry` using the application’s provider. Operation spans inherit the active parent, ordinary Workers expose tracing context, and failed attempts remain failures even when retry handling succeeds; see the OpenTelemetry integration guide for ownership and setup.
