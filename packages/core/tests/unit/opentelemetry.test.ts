import { it as effectIt } from "@effect/vitest";
import { context, trace } from "@opentelemetry/api";
import type { Tracer, TracerProvider } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  AlwaysOffSampler,
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Exit } from "effect";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { openTelemetry } from "@/opentelemetry.js";
import { Monque } from "@/scheduler/monque.js";
import { makeOperationTelemetry } from "@/scheduler/services/operation-telemetry.js";
import { createMockContext } from "@tests/factories";

describe("OpenTelemetry", () => {
  const manager = new AsyncLocalStorageContextManager();
  context.setGlobalContextManager(manager.enable());
  afterEach(() => {
    context.disable();
    context.setGlobalContextManager(manager.enable());
  });

  it("exports an operation under the active application parent without payloads", async () => {
    const exporter = new InMemorySpanExporter();

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const ctx = createMockContext();
    ctx.mockCollection.insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const scheduler = new Monque(fromPartial<Db>({ collection: () => ctx.collection }), {
      skipIndexCreation: true,
      recoverStaleJobs: false,
      instrumentation: openTelemetry(provider),
    });

    await scheduler.initialize();
    const parent = provider.getTracer("application").startSpan("request");
    await context.with(trace.setSpan(context.active(), parent), async () => {
      await scheduler.enqueue("email", { secret: "never exported" });
    });
    parent.end();
    await scheduler.dispose();
    await provider.forceFlush();
    const span = exporter.getFinishedSpans().find((item) => item.name === "monque.intake.enqueue");
    expect(span?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(span?.attributes).toStrictEqual({ outcome: "success" });
    expect((span?.duration[0] ?? 0) * 1e9 + (span?.duration[1] ?? 0)).toBeGreaterThan(0);
    await provider.shutdown();
  });

  it("leaves tracing inactive until an instance explicitly opts in", async () => {
    const exporter = new InMemorySpanExporter();

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    openTelemetry(provider);

    const ctx = createMockContext();
    ctx.mockCollection.insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const scheduler = new Monque(fromPartial<Db>({ collection: () => ctx.collection }), {
      skipIndexCreation: true,
      recoverStaleJobs: false,
    });

    await scheduler.initialize();
    await scheduler.enqueue("work", {});
    await scheduler.dispose();
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()).toStrictEqual([]);
    await provider.shutdown();
  });
});

describe("telemetry failure isolation", () => {
  it("preserves synchronous callback throws and Promise results when span observation fails", async () => {
    const provider = fromPartial<TracerProvider>({
      getTracer: () =>
        fromPartial<Tracer>({
          startSpan: () => {
            throw new Error("observer unavailable");
          },
        }),
    });

    const ctx = createMockContext();
    ctx.mockCollection.insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const scheduler = new Monque(fromPartial<Db>({ collection: () => ctx.collection }), {
      skipIndexCreation: true,
      recoverStaleJobs: false,
      instrumentation: openTelemetry(provider),
    });

    await scheduler.initialize();
    const failure = new Error("callback failed");
    scheduler.on("job:error", () => {
      throw failure;
    });
    expect(() => scheduler.emit("job:error", { error: new Error("original") })).toThrow(failure);
    await expect(scheduler.enqueue("work", {})).resolves.toHaveProperty("name", "work");
    await scheduler.dispose();
  });

  it("preserves an admitted operation when the actual exporter throws", async () => {
    const exporter = new InMemorySpanExporter();

    const exportSpan = vi.spyOn(exporter, "export").mockImplementation(() => {
      throw new Error("export unavailable");
    });

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const ctx = createMockContext();
    ctx.mockCollection.insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const scheduler = new Monque(fromPartial<Db>({ collection: () => ctx.collection }), {
      skipIndexCreation: true,
      recoverStaleJobs: false,
      instrumentation: openTelemetry(provider),
    });

    await scheduler.initialize();
    await expect(scheduler.enqueue("work", {})).resolves.toHaveProperty("name", "work");
    await scheduler.dispose();
    expect(exportSpan).toHaveBeenCalledWith();
    await provider.shutdown();
  });
});

describe("exported interruptions", () => {
  effectIt.effect("distinguishes interruption from Worker failure", () =>
    Effect.gen(function* verifyInterruptedExport() {
      const exporter = new InMemorySpanExporter();

      const provider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      const telemetry = makeOperationTelemetry(openTelemetry(provider).tracer);
      const exit = yield* telemetry.observe("worker", Effect.interrupt).pipe(Effect.exit);
      const [span] = exporter.getFinishedSpans();
      expect(Exit.isFailure(exit)).toBe(true);
      expect(span?.attributes).toStrictEqual({
        outcome: "interrupted",
        "effect.fiber.interrupted": true,
      });
      yield* Effect.promise(async () => {
        await provider.shutdown();
      });
    }),
  );
});

describe("host sampling", () => {
  it("preserves a host decision not to sample in active downstream context", async () => {
    const provider = new BasicTracerProvider({ sampler: new AlwaysOffSampler() });
    const ctx = createMockContext();
    let flags: number | undefined;
    ctx.mockCollection.insertOne.mockImplementation(async () => {
      flags = trace.getActiveSpan()?.spanContext().traceFlags;

      return await Promise.resolve({ acknowledged: true, insertedId: new ObjectId() });
    });

    const scheduler = new Monque(fromPartial<Db>({ collection: () => ctx.collection }), {
      skipIndexCreation: true,
      recoverStaleJobs: false,
      instrumentation: openTelemetry(provider),
    });

    await scheduler.initialize();
    await scheduler.enqueue("work", {});
    expect(flags).toBe(0);
    await scheduler.dispose();
    await provider.shutdown();
  });
});
