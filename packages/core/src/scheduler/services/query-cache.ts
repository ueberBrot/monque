import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
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
  private readonly pending = new Map<string, Deferred.Deferred<T, E>>();
  private generation = 0;
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
          return yield* restore(Deferred.await(pending));
        }
        const { generation } = this;
        const request = yield* Deferred.make<T, E>();
        this.pending.set(key, request);
        yield* Effect.forkDetach(
          Effect.gen({ self: this }, function* loadUncachedQuery() {
            const result = yield* Effect.exit(
              Effect.suspend(load).pipe(
                Effect.tap((value) =>
                  Effect.gen({ self: this }, function* storeQueryResult() {
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
                  }),
                ),
              ),
            );
            if (this.pending.get(key) === request) {
              this.pending.delete(key);
            }
            yield* Deferred.done(request, result);
          }),
          { startImmediately: true, uninterruptible: true },
        );
        return yield* restore(Deferred.await(request));
      }),
    );
  }
  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.pending.clear();
  }
}
