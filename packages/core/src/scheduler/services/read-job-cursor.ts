import { Effect } from "effect";

import { JobPersistenceError } from "./job-persistence-error.js";

/** Own only this read's cursor, never its borrowed Collection or connection. */
export const readJobCursor = <T, C extends { readonly close: () => Promise<void> }>(
  acquire: () => C,
  read: (cursor: C) => Promise<T[]>,
): Effect.Effect<T[], JobPersistenceError> =>
  Effect.acquireUseRelease(
    Effect.try({ try: acquire, catch: (cause) => new JobPersistenceError({ cause }) }),
    (cursor) =>
      Effect.tryPromise({
        try: async () => await read(cursor),
        catch: (cause) => new JobPersistenceError({ cause }),
      }),
    // Match native cursor iteration: cleanup must not replace the read's failure.
    (cursor) =>
      Effect.promise(async () => {
        await cursor.close();
      }).pipe(Effect.ignoreCause),
  );
