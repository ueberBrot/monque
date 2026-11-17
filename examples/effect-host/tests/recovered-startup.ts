// @effect-diagnostics unstableApiUsage:off
import { BunRuntime } from "@effect/platform-bun";
import { Effect, Exit } from "effect";

import { host } from "../src/host.js";
import { configuration } from "../src/options.js";

BunRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* recoverStartup() {
      const options = yield* configuration;
      const result = yield* Effect.exit(host(options));

      if (Exit.isSuccess(result)) {
        return yield* Effect.die(new Error("Expected occupied-listener startup failure"));
      }

      yield* Effect.log("Startup recovered; parent scope remains open");

      return yield* Effect.never;
    }),
  ),
);
