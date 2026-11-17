// @effect-diagnostics unstableApiUsage:off
import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";

import { HostError } from "../src/host-error.js";
import { host } from "../src/host.js";
import { configuration } from "../src/options.js";

// Browser matrix fault variant: same application and real adapters, failing host hook.
BunRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* failingPolicyHost() {
      const options = yield* configuration;

      const app = yield* host({
        ...options,
        authorize: () => Effect.fail(new HostError({ message: "private policy failure" })),
      });

      yield* Effect.log(`Dashboard: ${app.url}${options.dashboardPath}; Job: ${app.jobId}`);

      return yield* Effect.never;
    }),
  ),
);
