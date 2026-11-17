import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { assert, it, describe } from "vitest";

import { packRelease } from "../../../../scripts/verification/pack-release.mts";

describe("isolated package consumption", () => {
  it("packed Dashboard adapter supports an isolated Node consumer", async () => {
    // oxlint-disable-next-line typescript/strict-void-return -- Node promisify accepts the value-returning execFile callback API.
    const exec = promisify(execFile);
    const directory = await mkdtemp(path.join(tmpdir(), "dashboard-effect-consumer-"));
    const root = path.resolve(import.meta.dirname, "../../../..");

    try {
      const archives = await packRelease(root, ["dashboard", "dashboard-effect"], directory);
      const dashboard = archives["@monque/dashboard"];
      const adapter = archives["@monque/dashboard-effect"];
      assert.ok(dashboard !== undefined);
      assert.ok(adapter !== undefined);
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({
          type: "module",
          overrides: { "@monque/dashboard": `file:${dashboard}` },
          dependencies: {
            "@monque/dashboard": `file:${dashboard}`,
            "@monque/dashboard-effect": `file:${adapter}`,
            effect: "4.1.4",
            vitest: "5.1.0",
            "@effect/platform-node": "4.1.4",
          },
        }),
      );
      await writeFile(
        path.join(directory, "consumer.test.mts"),
        await readFile(new URL("consumer.test.mts", import.meta.url), "utf-8"),
      );
      await exec("bun", ["install", "--ignore-scripts"], { cwd: directory });

      const result = await exec(
        "node",
        ["node_modules/vitest/vitest.mjs", "run", "consumer.test.mts", "--exclude", "release/**"],
        { cwd: directory },
      );

      process.stdout.write(result.stdout);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
