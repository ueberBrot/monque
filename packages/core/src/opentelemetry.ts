import { makeProducer } from "@effect/opentelemetry/OtelMetrics";
import { make, makeExternalSpan, OtelTracer } from "@effect/opentelemetry/OtelTracer";
import { Resource as EffectResource } from "@effect/opentelemetry/Resource";
import { trace } from "@opentelemetry/api";
import type { TracerProvider } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { Resource } from "@opentelemetry/resources";
import type { MetricProducer } from "@opentelemetry/sdk-metrics";
import { Effect, Metric } from "effect";

import type { MonqueInstrumentation } from "./scheduler/types.js";

export interface OpenTelemetryOptions {
  readonly metrics?: { readonly resource: Resource };
}

/** Use a host-owned provider. This never registers globals or shuts down the provider. */
export const openTelemetry = (
  provider: TracerProvider,
  options?: OpenTelemetryOptions,
): MonqueInstrumentation & { readonly metricProducer: MetricProducer } => {
  const producers = new Map<MetricProducer, string>();
  const resource = options?.metrics?.resource ?? resourceFromAttributes({});

  const metricProducer: MetricProducer = {
    async collect(collectOptions) {
      const results = await Promise.all(
        [...producers].map(async ([producer, instanceId]) => {
          try {
            const result = await producer.collect(collectOptions);

            return {
              ...result,
              resourceMetrics: {
                ...result.resourceMetrics,
                scopeMetrics: result.resourceMetrics.scopeMetrics.map((scope) => ({
                  ...scope,
                  scope: {
                    ...scope.scope,
                    // Readers replace producer resources, so instance identity belongs to the scope.
                    name: `@monque/core/${instanceId}`,
                  },
                })),
              },
            };
          } catch (error) {
            return {
              resourceMetrics: { resource, scopeMetrics: [] },
              errors: [error],
            };
          }
        }),
      );

      return {
        resourceMetrics: {
          resource,
          scopeMetrics: results.flatMap((result) => result.resourceMetrics.scopeMetrics),
        },
        errors: results.flatMap((result) => result.errors),
      };
    },
  };

  const instrumentation: MonqueInstrumentation & { readonly metricProducer: MetricProducer } = {
    metricProducer,
    tracer: Effect.runSync(
      make.pipe(Effect.provideService(OtelTracer, provider.getTracer("@monque/core"))),
    ),
    parentSpan: () => {
      const parent = trace.getActiveSpan()?.spanContext();

      return parent && trace.isSpanContextValid(parent) ? makeExternalSpan(parent) : undefined;
    },
  };

  const metrics = options?.metrics;

  if (metrics) {
    return {
      ...instrumentation,
      metrics: (registry, instanceId) =>
        Effect.acquireRelease(
          makeProducer().pipe(
            Effect.provideService(Metric.MetricRegistry, registry),
            Effect.provideService(EffectResource, resource),
            Effect.tap((producer) =>
              Effect.sync(() => {
                producers.set(producer, instanceId);
              }),
            ),
          ),
          (producer) =>
            Effect.sync(() => {
              producers.delete(producer);
            }),
        ).pipe(Effect.asVoid),
    };
  }

  return instrumentation;
};
