import { Cause, Clock, Context, Duration, Effect, Exit, Layer, Metric, Tracer } from "effect";

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
const safeTracer = (observer: Tracer.Tracer): Tracer.Tracer =>
  Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const observed = report(() => observer.span(options));
      report(() => {
        // Copy identity once; Effect evaluation never reads observer getters.
        const spanId = observed?.spanId;
        const traceId = observed?.traceId;
        span._spanId = spanId;
        span._traceId = traceId;
      });
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
    // A supplied context evaluator wraps application evaluation, so is not reporting.
  });

export const makeOperationTelemetry = (
  observer: Tracer.Tracer = Tracer.nativeTracer,
  registry: Metric.MetricRegistry = new Map(),
) => {
  const tracer = safeTracer(observer);

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

export const makeOperationTelemetryLayer = Layer.effect(
  OperationTelemetry,
  Effect.gen(function* acquireOperationTelemetry() {
    return makeOperationTelemetry(yield* Tracer.Tracer, yield* Metric.MetricRegistry);
  }),
).pipe(
  Layer.provideMerge(
    Layer.effect(
      Metric.MetricRegistry,
      Effect.sync(() => new Map()),
    ),
  ),
);
