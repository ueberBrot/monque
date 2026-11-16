import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  DataPointType,
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  MeterProvider,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Context, Data, Deferred, Effect, Tracer } from "effect";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { Monque, MonqueEffect, MonqueError, NonRetryableError } from "@/index";
import { openTelemetry } from "@/opentelemetry.js";
import { failureInstrumentation, telemetryFaults } from "@test-utils/telemetry-faults";
import { cleanupTestDb, getTestDb, waitFor } from "@test-utils/test-utils";

class NativeMailer extends Context.Service<NativeMailer, { delivered: string[] }>()(
  "test/NativeMailer",
) {}

const NativeWorkerFailure = Data.TaggedError("NativeWorkerFailure");

describe("OpenTelemetry", () => {
  const manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);

  afterAll(() => {
    context.disable();
    manager.disable();
  });

  it.each(telemetryFaults)(
    "keeps observed Worker callbacks synchronous, reentrant and unreplayed (%s)",
    async (fault) => {
      const db = await getTestDb(`callback-telemetry-${fault}`);
      const { provider, options, reportingCalls } = failureInstrumentation(fault);

      const scheduler = new Monque(db, {
        pollInterval: 10,
        maxRetries: 0,
        ...options,
      });

      const order: string[] = [];
      const failure = new MonqueError("start callback failed");
      let reported: unknown;

      const handler = vi.fn<() => Promise<void>>(async () => {
        await Promise.resolve();
      });

      scheduler.on("job:start", () => {
        order.push("start");
        scheduler.pause();
        expect(scheduler.isPaused()).toBe(true);
        scheduler.resume();
        expect(scheduler.isPaused()).toBe(false);

        expect(trace.getActiveSpan() !== undefined).toBe(fault !== "absent");

        order.push("reentered");

        throw failure;
      });
      scheduler.on("job:fail", ({ error }) => {
        order.push("failure");
        reported = error;
      });

      try {
        await scheduler.initialize();
        scheduler.register("work", handler);
        const job = await scheduler.enqueue("work", {});
        scheduler.start();
        await waitFor(() => reported !== undefined);
        expect(reported).toBe(failure);
        expect(order).toStrictEqual(["start", "reentered", "failure"]);
        expect(handler).not.toHaveBeenCalled();
        await expect(scheduler.getJob(job._id)).resolves.toMatchObject({
          status: "failed",
          failCount: 1,
        });

        expect(reportingCalls() > 0).toBe(fault !== "absent");
      } finally {
        await scheduler.dispose();
        await provider.shutdown();
        await cleanupTestDb(db);
      }
    },
  );

  it("activates Worker context across awaits, records failed attempts and leaves the host and other instances alive", async () => {
    const db = await getTestDb("otel");
    const exporter = new InMemorySpanExporter();

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const resource = resourceFromAttributes({ "service.name": "host" });
    const instrumentation = openTelemetry(provider, { metrics: { resource } });
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);

    const reader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 60_000,
      metricProducers: [instrumentation.metricProducer],
    });

    const meterProvider = new MeterProvider({ resource, readers: [reader] });
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
      await meterProvider.forceFlush();

      const measurements = metricExporter
        .getMetrics()
        .flatMap((item) => item.scopeMetrics)
        .flatMap((scope) => scope.metrics);

      expect(
        measurements.find((metric) => metric.descriptor.name === "monque.operations")?.dataPoints,
      ).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attributes: { operation: "worker", outcome: "failure" },
            value: 1,
          }),
          expect.objectContaining({
            attributes: { operation: "execution", outcome: "failure" },
            value: 1,
          }),
        ]),
      );
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

      expect(spans.find((span) => span.name === "monque.execution")?.attributes["outcome"]).toBe(
        "failure",
      );
      expect({
        workerStatus: worker?.status.code,
        hostAlive: spans.some((span) => span.name === "host-after-dispose"),
        enqueues: spans.filter((span) => span.name === "monque.intake.enqueue").length,
        payload: JSON.stringify(spans.map((span) => span.attributes)).includes("excluded"),
      }).toStrictEqual({
        workerStatus: SpanStatusCode.ERROR,
        hostAlive: true,
        enqueues: 2,
        payload: false,
      });
    } finally {
      await first.dispose();
      await second.dispose();
      await meterProvider.shutdown();
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

  it.each(["failure", "interrupted"])(
    "exports native Worker %s through the shared metrics configuration",
    async (outcome) => {
      const db = await getTestDb(`native-metrics-${outcome}`);
      const provider = new BasicTracerProvider();
      const resource = resourceFromAttributes({ "service.name": "native-host" });
      const instrumentation = openTelemetry(provider, { metrics: { resource } });
      const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);

      const reader = new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 60_000,
        metricProducers: [instrumentation.metricProducer],
      });

      const host = new MeterProvider({ resource, readers: [reader] });

      try {
        await Effect.runPromise(
          Effect.gen(function* nativeMetricConsumer() {
            const scheduler = yield* MonqueEffect;
            yield* scheduler.register("native-work", () =>
              Effect.yieldNow.pipe(
                Effect.andThen(
                  outcome === "failure"
                    ? Effect.fail(new NativeWorkerFailure(undefined))
                    : Effect.interrupt,
                ),
              ),
            );
            const job = yield* scheduler.enqueue("native-work", {});
            yield* scheduler.start;
            const run = Effect.runPromiseWith(yield* Effect.context());
            yield* Effect.promise(async () => {
              await waitFor(async () => {
                const current = await run(scheduler.getJob(job._id));

                return current?.failCount === 1;
              });
            });
            yield* scheduler.stop;
            yield* Effect.promise(async () => {
              await host.forceFlush();
            });

            const metrics = exporter
              .getMetrics()
              .flatMap((item) => item.scopeMetrics)
              .flatMap((scope) => scope.metrics);

            expect(
              metrics.find((metric) => metric.descriptor.name === "monque.operations")?.dataPoints,
            ).toStrictEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  attributes: { operation: "worker", outcome },
                  value: 1,
                }),
                expect.objectContaining({
                  attributes: { operation: "execution", outcome },
                  value: 1,
                }),
                expect.objectContaining({
                  attributes: { operation: "intake.enqueue", outcome: "success" },
                  value: 1,
                }),
              ]),
            );

            const duration = metrics.find(
              (metric) => metric.descriptor.name === "monque.operation.duration",
            );

            const workerDuration =
              duration?.dataPointType === DataPointType.HISTOGRAM
                ? duration.dataPoints.find(
                    (point) =>
                      point.attributes["operation"] === "worker" &&
                      point.attributes["outcome"] === outcome,
                  )?.value
                : undefined;

            expect(duration?.descriptor.unit).toBe("milliseconds");
            expect(workerDuration?.count).toBe(1);
            expect(workerDuration?.sum).toBeGreaterThan(0);
          }).pipe(
            Effect.provide(
              MonqueEffect.layer(db, {
                instrumentation,
                pollInterval: 10,
                baseRetryInterval: 60_000,
              }),
            ),
          ),
        );
        exporter.reset();
        const hostCount = host.getMeter("app").createCounter("native-host.alive");
        hostCount.add(1);
        await host.forceFlush();
        const scopes = exporter.getMetrics().flatMap((item) => item.scopeMetrics);
        expect(scopes.some((scope) => scope.scope.name.startsWith("@monque/core/"))).toBe(false);
        expect(
          scopes
            .flatMap((scope) => scope.metrics)
            .find((metric) => metric.descriptor.name === "native-host.alive")?.dataPoints[0]?.value,
        ).toBe(1);
      } finally {
        await host.shutdown();
        await provider.shutdown();
        await cleanupTestDb(db);
      }
    },
  );
});
