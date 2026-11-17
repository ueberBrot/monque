/* oxlint-disable anti-slop/no-known-value-widening -- Package names are collected dynamically from packed workspace archives. */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { packRelease } from "../../../../scripts/verification/pack-release.mts";

const root = path.resolve(import.meta.dirname, "../../../..");
const temporary = mkdtempSync(path.join(tmpdir(), "management-effect-consumer-"));

const run = (command: string, args: string[], cwd = temporary) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });

try {
  const dependencies: Record<string, string> = { effect: "4.1.4", mongodb: "7.9.0" };

  const archives = await packRelease(root, ["core", "management", "management-effect"], temporary);
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
      devDependencies: { "@types/node": "^22.20.5" },
    }),
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
  copyFileSync(path.join(import.meta.dirname, "app.mts"), path.join(temporary, "app.mts"));
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
      include: ["app.mts"],
    }),
  );
  run(path.join(root, "node_modules/.bin/tsrs"), ["-p", "tsconfig.json"]);
  run("node", ["--experimental-strip-types", "app.mts"]);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
