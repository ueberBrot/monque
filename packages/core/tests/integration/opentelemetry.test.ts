import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Context, Deferred, Effect, Tracer } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { Monque, MonqueEffect, NonRetryableError } from "@/index";
import { openTelemetry } from "@/opentelemetry.js";
import { cleanupTestDb, getTestDb, waitFor } from "@test-utils/test-utils";

class NativeMailer extends Context.Service<NativeMailer, { delivered: string[] }>()(
  "test/NativeMailer",
) {}

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

  it("preserves native caller parents and exports downstream Effect Worker spans", async () => {
    const db = await getTestDb("otel-native");
    const exporter = new InMemorySpanExporter();

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const delivered: string[] = [];
    let requestSpanId: string | undefined;

    try {
      await Effect.runPromise(
        Effect.gen(function* nativeTracing() {
          const scheduler = yield* MonqueEffect;
          const completed = yield* Deferred.make<undefined>();
          const applicationTracer = yield* Tracer.Tracer;
          yield* scheduler
            .register("native", () =>
              Effect.gen(function* nativeMail() {
                const mailer = yield* NativeMailer;
                yield* Effect.yieldNow;
                mailer.delivered.push("hello");
                yield* Deferred.succeed(completed, undefined);
              }).pipe(Effect.withSpan("native-downstream")),
            )
            .pipe(
              Effect.provideService(NativeMailer, { delivered }),
              Effect.provideService(Tracer.Tracer, applicationTracer),
              Effect.withSpan("registration"),
            );
          yield* Effect.gen(function* request() {
            requestSpanId = (yield* Effect.currentSpan).spanId;
            yield* scheduler.now("native", {});
          }).pipe(Effect.withSpan("native-request"));
          yield* scheduler.start;
          yield* Deferred.await(completed);
          yield* scheduler.stop;
        }).pipe(
          Effect.provide(
            MonqueEffect.layer(db, { instrumentation: openTelemetry(provider), pollInterval: 10 }),
          ),
        ),
      );
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      const worker = spans.find((span) => span.name === "monque.worker");
      expect(delivered).toStrictEqual(["hello"]);
      expect(worker).toBeDefined();
      expect(spans.find((span) => span.name === "native-downstream")).toBeDefined();
      expect(
        spans.find((span) => span.name === "native-downstream")?.parentSpanContext?.spanId,
      ).toBe(worker?.spanContext().spanId);
      expect(
        spans.find((span) => span.name === "monque.intake.enqueue")?.parentSpanContext?.spanId,
      ).toBe(requestSpanId);
    } finally {
      await provider.shutdown();
      await cleanupTestDb(db);
    }
  });
});
