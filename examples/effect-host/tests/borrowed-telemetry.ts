// @effect-diagnostics unstableApiUsage:off
import { BunRuntime } from "@effect/platform-bun";
import { openTelemetry } from "@monque/core/opentelemetry";
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Effect } from "effect";

import { host } from "../src/host.js";
import { configuration } from "../src/options.js";

// An embedding application owns this provider outside the complete host's scope.
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
});

BunRuntime.runMain(
  Effect.gen(function* borrowedProvider() {
    const options = yield* configuration;
    yield* Effect.scoped(host({ ...options, instrumentation: openTelemetry(provider) }));
    provider.getTracer("embedding-app").startSpan("host-still-active").end();
    yield* Effect.promise(async () => {
      await provider.forceFlush();
      await provider.shutdown();
    });
  }),
);
