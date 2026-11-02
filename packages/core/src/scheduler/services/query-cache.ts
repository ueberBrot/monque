import { Clock, Effect, Fiber } from "effect";
import type { Scope } from "effect";

/** Bounded snapshots with shared in-flight reads. Failed reads are never cached. */
export class QueryCache<T, E = unknown> {
  private readonly entries = new Map<
    string,
    {
      value: T;
      completedAt: bigint;
      ttl: number;
    }
  >();
  private readonly pending = new Map<string, Fiber.Fiber<T, E>>();
  private generation = 0;
  private readonly owner: Scope.Scope;
  constructor(owner: Scope.Scope) {
    this.owner = owner;
  }
  get(key: string, ttl: number, load: () => Effect.Effect<T, E>): Effect.Effect<T, E> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* readCachedQuery() {
        const now = yield* Clock.monotonicTimeNanos;
        const cached = this.entries.get(key);

        if (ttl > 0 && cached && Number(now - cached.completedAt) / 1_000_000 < cached.ttl) {
          this.entries.delete(key);
          this.entries.set(key, cached);

          return cached.value;
        }

        const pending = this.pending.get(key);

        if (pending) {
          return yield* restore(Fiber.join(pending));
        }

        const { generation } = this;

        const request = yield* Effect.forkIn(
          Effect.suspend(load).pipe(Effect.tap((value) => this.store(key, ttl, generation, value))),
          this.owner,
        );

        this.pending.set(key, request);
        request.addObserver(() => {
          if (this.pending.get(key) === request) {
            this.pending.delete(key);
          }
        });

        return yield* restore(Fiber.join(request));
      }),
    );
  }
  private readonly store = Effect.fnUntraced(function* storeQueryResult(
    this: QueryCache<T, E>,
    key: string,
    ttl: number,
    generation: number,
    value: T,
  ) {
    const completedAt = yield* Clock.monotonicTimeNanos;

    if (ttl > 0 && generation === this.generation) {
      this.entries.delete(key);

      if (this.entries.size >= 100) {
        const oldest = this.entries.keys().next().value;

        if (oldest !== undefined) {
          this.entries.delete(oldest);
        }
      }

      this.entries.set(key, { value, completedAt, ttl });
    }
  });
  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.pending.clear();
  }
}
