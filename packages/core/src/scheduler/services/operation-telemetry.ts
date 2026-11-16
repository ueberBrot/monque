import { Cause, Clock, Context, Duration, Effect, Exit, Layer, Metric, Tracer } from "effect";

import type { MonqueInstrumentation } from "../types.js";

/** Fixed semantic vocabulary. User input never becomes a measurement dimension. */
type Operation =
  | "intake.enqueue"
  | "intake.batch"
  | "intake.schedule"
  | "dispatch"
  | "claim.acquire"
  | "claim.release"
  | "execution"
  | "validation"
  | "worker"
  | "result.complete"
  | "result.fail"
  | "recovery";

interface ReportingState {
  readonly clock: Clock.Clock;
  readonly started: bigint;
  readonly span: Tracer.Span;
}

// Only observer calls belong in this guard, never application code.
const report = <A>(hook: () => A): A | undefined => {
  try {
    return hook();
  } catch {
    return undefined;
  }
};

/** Trust native span state, with guarded delegation to the finite internal observer. */
const safeTracer = (observer: Tracer.Tracer, context: Tracer.Tracer["context"]): Tracer.Tracer =>
  Tracer.make({
    span(options) {
      const observed = report(() => observer.span(options));

      // Copy identity and the host sampling decision once. Effect evaluation
      // must never read observer getters outside the reporting guard.
      const identity = report(
        () =>
          observed && {
            spanId: observed.spanId,
            traceId: observed.traceId,
            sampled: observed.sampled,
          },
      );

      const span = new Tracer.NativeSpan({
        ...options,
        sampled: identity?.sampled ?? options.sampled,
      });

      span._spanId = identity?.spanId;
      span._traceId = identity?.traceId;
      const end = span.end.bind(span);
      const attribute = span.attribute.bind(span);
      const event = span.event.bind(span);
      const addLinks = span.addLinks.bind(span);
      span.end = (...args) => {
        end(...args);
        report(() => observed?.end(...args));
      };

      span.attribute = (...args) => {
        attribute(...args);
        report(() => observed?.attribute(...args));
      };

      span.event = (...args) => {
        event(...args);
        report(() => observed?.event(...args));
      };

      span.addLinks = (...args) => {
        addLinks(...args);
        report(() => observed?.addLinks(...args));
      };

      return span;
    },
    // The context evaluator runs application code; catching its throws could
    // evaluate callbacks twice or replace their failures.
    context,
  });

export const makeOperationTelemetry = (
  observer: Tracer.Tracer = Tracer.nativeTracer,
  registry: Metric.MetricRegistry = new Map(),
  context?: Tracer.Tracer["context"],
) => {
  const tracer = safeTracer(observer, context);

  const finish = (
    operation: Operation,
    setup: ReportingState | undefined,
    exit: Exit.Exit<unknown, unknown>,
  ) =>
    Effect.suspend(() => {
      let outcome = "success";

      if (Exit.isFailure(exit)) {
        outcome = Cause.hasInterruptsOnly(exit.cause) ? "interrupted" : "failure";
      }

      const attributes = { operation, outcome };

      const elapsed = setup
        ? Duration.nanos(setup.clock.monotonicTimeNanosUnsafe() - setup.started)
        : undefined;

      const count = Metric.counter("monque.operations", { attributes, incremental: true });
      const duration = Metric.timer("monque.operation.duration", { attributes });

      const end = Effect.sync(() => {
        if (setup) {
          setup.span.attribute("outcome", outcome);
          setup.span.end(setup.clock.currentTimeNanosUnsafe(), exit);
        }
      }).pipe(Effect.ignoreCause);

      return Effect.gen(function* finishReporting() {
        // Each sink is independent; a failed metric hook cannot prevent span end.
        yield* Metric.update(count, 1).pipe(Effect.ignoreCause);

        if (elapsed !== undefined) {
          yield* Metric.update(duration, elapsed).pipe(Effect.ignoreCause);
        }

        yield* end;
      });
    }).pipe(
      Effect.provideService(Metric.MetricRegistry, registry),
      Effect.provideService(Metric.CurrentMetricAttributes, {}),
      Effect.ignoreCause,
    );

  const observe = <A, E, R>(operation: Operation, body: Effect.Effect<A, E, R>) =>
    Effect.gen(function* observeOperation() {
      const setup = yield* Effect.gen(function* startReporting() {
        const clock = yield* Clock.Clock;
        const started = clock.monotonicTimeNanosUnsafe();
        const span = yield* Effect.makeSpan(`monque.${operation}`);

        return { clock, started, span };
      }).pipe(
        Effect.provideService(Tracer.Tracer, tracer),
        Effect.catchCause(() => Effect.void),
      );

      const traced = setup ? Effect.provideService(body, Tracer.ParentSpan, setup.span) : body;

      return yield* traced.pipe(
        Effect.provideService(Tracer.Tracer, tracer),
        Effect.onExit((exit) => finish(operation, setup || undefined, exit)),
      );
    });

  return { observe };
};

/** Private composition seam; a fresh registry belongs to each initialized instance. */
export class OperationTelemetry extends Context.Service<
  OperationTelemetry,
  ReturnType<typeof makeOperationTelemetry>
>()("@monque/core/scheduler/OperationTelemetry") {}

const telemetryLayer = (
  instrumentation?: Tracer.Tracer,
  metrics?: MonqueInstrumentation["metrics"],
  instanceId = "",
) =>
  Layer.effect(
    OperationTelemetry,
    Effect.gen(function* acquireOperationTelemetry() {
      const registry = yield* Metric.MetricRegistry;

      if (metrics) {
        yield* Effect.suspend(() => metrics(registry, instanceId)).pipe(Effect.ignoreCause);
      }

      return makeOperationTelemetry(
        instrumentation ?? (yield* Tracer.Tracer),
        registry,
        instrumentation?.context?.bind(instrumentation),
      );
    }),
  ).pipe(
    Layer.provideMerge(
      Layer.effect(
        Metric.MetricRegistry,
        Effect.sync(() => new Map()),
      ),
    ),
  );

export const makeOperationTelemetryLayer = telemetryLayer();

/** Context evaluation is opt-in because it evaluates application code, not reporting hooks. */
export const makeTracingTelemetryLayer = (
  tracer: Tracer.Tracer,
  metrics?: MonqueInstrumentation["metrics"],
  instanceId?: string,
) => telemetryLayer(tracer, metrics, instanceId);
