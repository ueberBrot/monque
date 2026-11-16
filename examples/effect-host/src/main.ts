import { Effect } from "effect";

import { host } from "./host.js";
import { configuration } from "./options.js";

const program = Effect.scoped(
  Effect.gen(function* runHost() {
    const options = yield* configuration;

    const instrumentation = options.tracing
      ? yield* Effect.flatMap(
          Effect.promise(async () => await import("./tracing.js")),
          (module) => module.tracing,
        )
      : undefined;

    const app = yield* host(instrumentation ? { ...options, instrumentation } : options);
    yield* Effect.log(`Dashboard: ${app.url}${options.dashboardPath}; Job: ${app.jobId}`);

    return yield* Effect.never;
  }),
);

const controller = new AbortController();

const shutdown = () => {
  controller.abort();
};

process.once("SIGINT", shutdown);

process.once("SIGTERM", shutdown);

try {
  await Effect.runPromise(program, { signal: controller.signal });
} catch (error) {
  if (!controller.signal.aborted) {
    console.error(error);
    process.exitCode = 1;
  }
} finally {
  process.removeListener("SIGINT", shutdown);
  process.removeListener("SIGTERM", shutdown);
}
