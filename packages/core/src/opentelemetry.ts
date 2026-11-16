import { make, makeExternalSpan, OtelTracer } from "@effect/opentelemetry/OtelTracer";
import { trace } from "@opentelemetry/api";
import type { TracerProvider } from "@opentelemetry/api";
import { Effect } from "effect";

import type { MonqueInstrumentation } from "./scheduler/types.js";

/** Use a host-owned provider. This never registers globals or shuts down the provider. */
export const openTelemetry = (provider: TracerProvider): MonqueInstrumentation => ({
  tracer: Effect.runSync(
    make.pipe(Effect.provideService(OtelTracer, provider.getTracer("@monque/core"))),
  ),
  parentSpan: () => {
    const parent = trace.getActiveSpan()?.spanContext();

    return parent && trace.isSpanContextValid(parent) ? makeExternalSpan(parent) : undefined;
  },
});
