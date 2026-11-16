import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { Monque, NonRetryableError } from "@/index";
import { openTelemetry } from "@/opentelemetry.js";
import { cleanupTestDb, getTestDb, waitFor } from "@test-utils/test-utils";

describe("OpenTelemetry", () => {
  const manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);

  afterAll(() => {
    context.disable();
    manager.disable();
  });

  it("activates Worker context across awaits, records failed attempts and leaves the host and other instances alive", async () => {
    const db = await getTestDb("otel");
    const exporter = new InMemorySpanExporter();

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const instrumentation = openTelemetry(provider);
    const first = new Monque(db, { collectionName: "first", instrumentation, pollInterval: 10 });
    const second = new Monque(db, { collectionName: "second", instrumentation });

    try {
      await first.initialize();
      await second.initialize();
      let workerSpanId: string | undefined;
      let downstreamParent: string | undefined;
      first.register("work", async () => {
        workerSpanId = trace.getActiveSpan()?.spanContext().spanId;
        await Promise.resolve();
        downstreamParent = trace.getActiveSpan()?.spanContext().spanId;
        const child = provider.getTracer("application").startSpan("downstream");
        child.end();
        throw new NonRetryableError("worker failed");
      });
      const job = await first.enqueue("work", { secret: "excluded" });
      first.start();
      await waitFor(async () => {
        const current = await first.getJob(job._id);

        return current?.status === "failed";
      });
      await first.dispose();
      await second.enqueue("other", {});
      const host = provider.getTracer("application").startSpan("host-after-dispose");
      host.end();
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      const worker = spans.find((span) => span.name === "monque.worker");
      expect([workerSpanId, downstreamParent]).toStrictEqual([
        worker?.spanContext().spanId,
        worker?.spanContext().spanId,
      ]);
      expect(spans.find((span) => span.name === "downstream")?.parentSpanContext?.spanId).toBe(
        workerSpanId,
      );
      expect(worker?.status.code).toBe(SpanStatusCode.ERROR);
      expect(spans.find((span) => span.name === "monque.execution")?.attributes["outcome"]).toBe(
        "failure",
      );
      expect({
        hostAlive: spans.some((span) => span.name === "host-after-dispose"),
        enqueues: spans.filter((span) => span.name === "monque.intake.enqueue").length,
        payload: JSON.stringify(spans.map((span) => span.attributes)).includes("excluded"),
      }).toStrictEqual({ hostAlive: true, enqueues: 2, payload: false });
    } finally {
      await first.dispose();
      await second.dispose();
      await provider.shutdown();
      await cleanupTestDb(db);
    }
  });
});
