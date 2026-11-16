import { it as effectIt } from "@effect/vitest";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  DataPointType,
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { fromPartial } from "@total-typescript/shoehorn";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vite-plus/test";

import { openTelemetry } from "@/opentelemetry.js";
import { Monque } from "@/scheduler/monque.js";
import {
  OperationTelemetry,
  makeTracingTelemetryLayer,
} from "@/scheduler/services/operation-telemetry.js";
import { createMockContext } from "@tests/factories";

describe("OpenTelemetry metrics", () => {
  it("exports each instance once and unregisters only disposed instances from a shared host reader", async () => {
    const tracer = new BasicTracerProvider();

    const instrumentation = openTelemetry(tracer, {
      metrics: { resource: resourceFromAttributes({ "service.name": "host" }) },
    });

    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);

    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
      metricProducers: [instrumentation.metricProducer],
    });

    const host = new MeterProvider({ readers: [reader] });
    const counter = host.getMeter("host").createCounter("host.requests");
    const ctx = createMockContext();
    ctx.mockCollection.insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });
    const db = fromPartial<Db>({ collection: () => ctx.collection });

    const first = new Monque(db, {
      schedulerInstanceId: "first",
      skipIndexCreation: true,
      recoverStaleJobs: false,
      instrumentation,
    });

    const second = new Monque(db, {
      schedulerInstanceId: "second",
      skipIndexCreation: true,
      recoverStaleJobs: false,
      instrumentation,
    });

    try {
      await host.forceFlush();
      expect(
        exporter
          .getMetrics()
          .flatMap((resource) => resource.scopeMetrics)
          .flatMap((scope) => scope.metrics),
      ).toStrictEqual([]);
      await first.initialize();
      await second.initialize();
      await first.enqueue("secret-name", { tenant: "secret-payload" });
      await first.enqueue("another", {});
      await second.enqueue("other", {});
      await host.forceFlush();

      const resources = exporter
        .getMetrics()
        .flatMap((resource) => resource.scopeMetrics)
        .filter((scope) => scope.scope.name.startsWith("@monque/core/"));

      expect(resources).toHaveLength(2);

      for (const resource of resources) {
        const { metrics } = resource;
        const count = metrics.find((metric) => metric.descriptor.name === "monque.operations");

        const duration = metrics.find(
          (metric) => metric.descriptor.name === "monque.operation.duration",
        );

        const expected = resource.scope.name === "@monque/core/first" ? 2 : 1;

        expect({
          unit: count?.descriptor.unit,
          temporality: count?.aggregationTemporality,
          point: count?.dataPoints.find(
            (point) => point.attributes["operation"] === "intake.enqueue",
          ),
        }).toMatchObject({
          unit: "1",
          temporality: AggregationTemporality.CUMULATIVE,
          point: {
            attributes: { operation: "intake.enqueue", outcome: "success" },
            value: expected,
          },
        });

        const point =
          duration?.dataPointType === DataPointType.HISTOGRAM
            ? duration.dataPoints.find((item) => item.attributes["operation"] === "intake.enqueue")
            : undefined;

        expect({
          point,
          unit: duration?.descriptor.unit,
          positive: (point?.value.sum ?? 0) > 0,
        }).toMatchObject({
          unit: "milliseconds",
          positive: true,
          point: {
            attributes: {
              operation: "intake.enqueue",
              outcome: "success",
              time_unit: "milliseconds",
            },
            value: { count: expected },
          },
        });
        expect(JSON.stringify(metrics)).not.toContain("secret-");
      }

      exporter.reset();
      await first.dispose();
      await second.enqueue("still-alive", {});
      counter.add(1);
      await host.forceFlush();
      const final = exporter.getMetrics().flatMap((resource) => resource.scopeMetrics);
      expect(final.some((resource) => resource.scope.name === "@monque/core/first")).toBe(false);
      expect(final.some((resource) => resource.scope.name === "@monque/core/second")).toBe(true);
      expect(
        final
          .flatMap((scope) => scope.metrics)
          .find((metric) => metric.descriptor.name === "host.requests")?.dataPoints[0]?.value,
      ).toBe(1);
    } finally {
      await first.dispose();
      await second.dispose();
      await host.shutdown();
      await tracer.shutdown();
    }
  });
});

describe("metric outcomes", () => {
  effectIt.effect("exports exact Worker durations and failure/interruption counts", () =>
    Effect.gen(function* exportMetricOutcomes() {
      const provider = new BasicTracerProvider();
      const resource = resourceFromAttributes({});
      const instrumentation = openTelemetry(provider, { metrics: { resource } });
      const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);

      const reader = new PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 60_000,
        metricProducers: [instrumentation.metricProducer],
      });

      const host = new MeterProvider({ readers: [reader], resource });
      yield* Effect.acquireRelease(Effect.void, () =>
        Effect.promise(async () => {
          await host.shutdown();
          await provider.shutdown();
        }),
      );
      yield* Effect.gen(function* observeWorkerOutcomes() {
        const telemetry = yield* OperationTelemetry;

        const failed = yield* telemetry
          .observe("worker", Effect.sleep(25).pipe(Effect.andThen(Effect.fail("failure"))))
          .pipe(Effect.exit, Effect.forkChild);

        yield* TestClock.adjust(25);
        yield* Fiber.join(failed);
        yield* telemetry.observe("worker", Effect.interrupt).pipe(Effect.exit);
        yield* Effect.promise(async () => {
          await host.forceFlush();
        });

        const metrics = exporter
          .getMetrics()
          .flatMap((item) => item.scopeMetrics)
          .flatMap((scope) => scope.metrics);

        const count = metrics.find((metric) => metric.descriptor.name === "monque.operations");

        const duration = metrics.find(
          (metric) => metric.descriptor.name === "monque.operation.duration",
        );

        expect(count?.dataPoints).toStrictEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attributes: { operation: "worker", outcome: "failure" },
              value: 1,
            }),
            expect.objectContaining({
              attributes: { operation: "worker", outcome: "interrupted" },
              value: 1,
            }),
          ]),
        );
        expect(
          duration?.dataPointType === DataPointType.HISTOGRAM
            ? duration.dataPoints.map(({ attributes, value }) => ({
                attributes,
                count: value.count,
                sum: value.sum,
              }))
            : [],
        ).toStrictEqual([
          {
            attributes: { operation: "worker", outcome: "failure", time_unit: "milliseconds" },
            count: 1,
            sum: 25,
          },
          {
            attributes: { operation: "worker", outcome: "interrupted", time_unit: "milliseconds" },
            count: 1,
            sum: 0,
          },
        ]);
      }).pipe(
        Effect.provide(
          makeTracingTelemetryLayer(instrumentation.tracer, instrumentation.metrics, "native"),
        ),
      );
    }).pipe(Effect.scoped),
  );
});

describe("metric failure isolation", () => {
  it("keeps scheduling and synchronous callbacks intact when the metric exporter throws", async () => {
    const provider = new BasicTracerProvider();

    const instrumentation = openTelemetry(provider, {
      metrics: { resource: resourceFromAttributes({}) },
    });

    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);

    const exportMetrics = vi.spyOn(exporter, "export").mockImplementation(() => {
      throw new Error("offline");
    });

    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
      metricProducers: [instrumentation.metricProducer],
    });

    const host = new MeterProvider({ readers: [reader] });
    const ctx = createMockContext();
    ctx.mockCollection.insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const scheduler = new Monque(fromPartial<Db>({ collection: () => ctx.collection }), {
      skipIndexCreation: true,
      recoverStaleJobs: false,
      instrumentation,
    });

    try {
      await scheduler.initialize();
      await scheduler.enqueue("work", {});
      await host.forceFlush();
      expect(exportMetrics).toHaveBeenCalledOnce();
      const failure = new Error("callback");
      scheduler.on("job:error", () => {
        throw failure;
      });
      expect(() => scheduler.emit("job:error", { error: new Error("original") })).toThrow(failure);
      await expect(scheduler.enqueue("work", {})).resolves.toHaveProperty("name", "work");
    } finally {
      await scheduler.dispose();
      exportMetrics.mockRestore();
      await host.shutdown();
      await provider.shutdown();
    }
  });
});
