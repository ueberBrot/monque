import { openTelemetry } from "@monque/core/opentelemetry";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Effect } from "effect";

// Only the opt-in entry imports telemetry. The provider belongs to this application.
export const tracing = Effect.gen(function* acquireTracing() {
  const provider = yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new BasicTracerProvider({
          resource: resourceFromAttributes({ "service.name": "monque-effect-host" }),
          spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
        }),
    ),
    (value) =>
      Effect.promise(async () => {
        await value.shutdown();
      }).pipe(Effect.tap(() => Effect.log("Released telemetry"))),
  );

  return openTelemetry(provider);
});
