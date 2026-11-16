import type { Tracer, TracerProvider } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { fromPartial } from "@total-typescript/shoehorn";
import { vi } from "vite-plus/test";

import { openTelemetry } from "@/opentelemetry.js";
import type { MonqueOptions } from "@/scheduler/types.js";

type TelemetryFault = "absent" | "observer" | "exporter";

export const telemetryFaults: readonly TelemetryFault[] = ["absent", "observer", "exporter"];

export const failureInstrumentation = (fault: TelemetryFault) => {
  const exporter = new InMemorySpanExporter();
  const exporting = vi.spyOn(exporter, "export");

  if (fault === "exporter") {
    exporting.mockImplementation(() => {
      throw new Error("export unavailable");
    });
  }

  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });

  const observing = vi.fn<Tracer["startSpan"]>(() => {
    throw new Error("observer unavailable");
  });

  const observer = fromPartial<TracerProvider>({
    getTracer: () => fromPartial<Tracer>({ startSpan: observing }),
  });

  const options: MonqueOptions = {};

  if (fault !== "absent") {
    options.instrumentation = openTelemetry(fault === "observer" ? observer : provider);
  }

  const reporting = fault === "observer" ? observing : exporting;

  return {
    provider,
    options,
    reportingCalls: () => reporting.mock.calls.length,
  };
};
