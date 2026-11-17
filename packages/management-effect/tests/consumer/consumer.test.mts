import { createRequire } from "node:module";
import { Monque } from "@monque/core/effect";
import { createManagementEffectRoutes } from "@monque/management-effect";
import { Context, Effect } from "effect";
import { HttpRouter } from "effect/http";
import { MongoClient } from "mongodb";
// @effect-diagnostics unstableApiUsage:off
/* oxlint-disable eslint/no-await-in-loop -- The portable consumer checks sequential caller contexts. */
/* oxlint-disable anti-slop/no-runtime-typeof, sonarjs/no-require-or-define, typescript/no-unsafe-member-access -- Verify the packed CommonJS export as well as the typed ESM import. */
import { assert, it, describe } from "vitest";

describe("isolated package consumption", () => {
  it("portable Management exports and routes work in Node", async () => {
    class Identity extends Context.Service<Identity, string>()("consumer/Identity") {}

    const require = createRequire(import.meta.url);

    for (const dependency of ["express", "@effect/platform-bun", "@effect/platform-node"]) {
      assert.throws(() => {
        require.resolve(dependency);
      });
    }

    assert.strictEqual(
      typeof require("@monque/management-effect").createManagementEffectRoutes,
      "function",
    );

    const client = new MongoClient("mongodb://127.0.0.1:27017");
    const monque = new Monque(client.db("portable"), { schedulerInstanceId: "portable" });

    const { handler, dispose } = HttpRouter.toWebHandler(
      createManagementEffectRoutes({
        monque: monque.effects,
        prefix: "/ops",
        context: () => Identity,
        authorize: ({ context }) =>
          Effect.gen(function* authorize() {
            yield* Effect.yieldNow;

            return context === (yield* Identity);
          }),
      }),
    );

    try {
      for (const identity of ["alice", "bob"]) {
        const response = await handler(
          new Request("http://localhost/ops/api/v1/processing"),
          Context.make(Identity, identity),
        );

        assert.strictEqual(response.status, 200);
        assert.deepEqual(await response.json(), {
          instanceId: "portable",
          paused: false,
          globallyPaused: false,
        });
      }
    } finally {
      await dispose();
      await monque.dispose();
      await client.close();
    }
  }, 120_000);
});
