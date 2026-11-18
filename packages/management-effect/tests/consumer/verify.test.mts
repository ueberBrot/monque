import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
/* oxlint-disable anti-slop/no-known-value-widening -- Package names are collected dynamically from packed workspace archives. */
import { expect, it, describe } from "vitest";

import { packRelease } from "../../../../scripts/verification/pack-release.mts";

describe("isolated package consumption", () => {
  it("packed Management adapter supports an isolated Node consumer", async () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const temporary = mkdtempSync(path.join(tmpdir(), "management-effect-consumer-"));

    const run = (command: string, args: string[], cwd = temporary) =>
      execFileSync(command, args, { cwd, stdio: "inherit" });

    try {
      const dependencies: Record<string, string> = { effect: "4.1.4", mongodb: "7.9.0" };

      const archives = await packRelease(
        root,
        ["core", "management", "management-effect"],
        temporary,
      );

      Object.assign(
        dependencies,
        Object.fromEntries(
          Object.entries(archives).map(([name, archive]) => [name, `file:${archive}`]),
        ),
      );

      writeFileSync(
        path.join(temporary, "package.json"),
        JSON.stringify({
          dependencies,
          private: true,
          type: "module",
          devDependencies: { "@types/node": "^22.20.5", vitest: "5.1.0" },
        }),
      );
      // npm 10.9.9 crashes resolving Vitest's optional Vite peers (npm/cli#9787).
      run("npm", [
        "exec",
        "--yes",
        "--package=npm@11.16.0",
        "--",
        "npm",
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ]);
      copyFileSync(
        path.join(import.meta.dirname, "consumer.test.mts"),
        path.join(temporary, "consumer.test.mts"),
      );
      writeFileSync(
        path.join(temporary, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            types: ["node"],
            target: "ESNext",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ["consumer.test.mts"],
        }),
      );
      run(path.join(root, "node_modules/.bin/tsrs"), ["-p", "tsconfig.json"]);
      expect(() =>
        run("node", [
          "node_modules/vitest/vitest.mjs",
          "run",
          "consumer.test.mts",
          "--exclude",
          "release/**",
        ]),
      ).not.toThrow();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 120_000);
});
