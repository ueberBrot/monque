// @effect-diagnostics unstableApiUsage:off
import { BunRuntime } from "@effect/platform-bun";
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

BunRuntime.runMain(program);
