import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import { MongoDBContainer } from "@testcontainers/mongodb";
import { z } from "zod";

const root = nodePath.resolve(import.meta.dirname, "../..");
const packageNames = [
  "core",
  "management",
  "management-express",
  "dashboard",
  "dashboard-express",
  "tsed",
];
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) => arg === "--skip-build"),
  "Usage: bun scripts/verification/consumer.mts [--skip-build]",
);

const cancellation = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cancellation.abort(new Error(`Received ${signal}`));
  });
}

const commandErrorSchema = z
  .unknown()
  .transform((reason) =>
    reason instanceof Error ? reason : new Error("Consumer command failed", { cause: reason }),
  );
const packageManifestSchema = z.object({ name: z.string(), version: z.string() });

const run = async (
  command: string,
  commandArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
) => {
  cancellation.signal.throwIfAborted();
  const { promise, resolve, reject } = Promise.withResolvers<null>();
  {
    const useProcessGroup = process.platform !== "win32";
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
      detached: useProcessGroup,
    });
    let failure: Error | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid === undefined || child.pid === 0) {
        return;
      }
      try {
        if (useProcessGroup) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
          failure ??= commandErrorSchema.parse(error);
        }
      }
    };
    const stop = (reason: Error) => {
      failure ??= reason;
      kill("SIGTERM");
      escalation ??= setTimeout(() => {
        kill("SIGKILL");
      }, 2000);
    };
    const onAbort = () => {
      stop(commandErrorSchema.parse(cancellation.signal.reason));
    };
    const timeout = setTimeout(() => {
      stop(new Error(`${command} exceeded ten minutes`));
    }, 600_000);
    cancellation.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      failure ??= error;
    });
    child.once("close", (code, signal) => {
      // Stop descendants before deleting their install or shutting down MongoDB.
      if (failure !== undefined) {
        kill("SIGKILL");
      }
      clearTimeout(timeout);
      clearTimeout(escalation);
      cancellation.signal.removeEventListener("abort", onAbort);
      if (failure !== undefined) {
        reject(failure);
      } else if (code === 0) {
        resolve(null);
      } else {
        reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${signal ?? code}`));
      }
    });
  }
  await promise;
};

const scratch = await mkdtemp(nodePath.join(tmpdir(), "monque-consumer-"));
const reportDirectory = nodePath.join(root, ".verification");
await mkdir(reportDirectory, { recursive: true });
await rm(nodePath.join(reportDirectory, "consumer.json"), { force: true });
let container: StartedMongoDBContainer | undefined;
try {
  if (!args.includes("--skip-build")) {
    await run("vp", ["run", "--filter", "./packages/*", "build"], root);
  }
  const tarballs: Record<string, string> = {};
  const versions: Record<string, string> = {};
  const packPackage = async (index: number): Promise<void> => {
    const name = packageNames[index];
    if (name === undefined) {
      return;
    }
    const directory = nodePath.join(root, "packages", name);
    const manifest = packageManifestSchema.parse(
      JSON.parse(await readFile(nodePath.join(directory, "package.json"), "utf-8")),
    );
    versions[manifest.name] = manifest.version;
    const tarball = nodePath.join(scratch, `${name}.tgz`);
    await run(
      "bun",
      ["pm", "pack", "--filename", tarball, "--ignore-scripts", "--quiet"],
      directory,
    );
    tarballs[manifest.name] = tarball;
    await packPackage(index + 1);
  };
  await packPackage(0);

  const cases = [
    // 1.15.1 was never published; 1.16.0 is the first release satisfying ^1.15.1.
    { name: "minimum-core", core: "1.16.0", management: tarballs["@monque/management"] },
    { name: "minimum-management", core: tarballs["@monque/core"], management: "0.8.0" },
    { name: "current", core: tarballs["@monque/core"], management: tarballs["@monque/management"] },
  ];
  const mongoContainer = await new MongoDBContainer("mongo:8").start();
  container = mongoContainer;
  const results: unknown[] = [];
  const verifyCase = async (index: number): Promise<void> => {
    const scenario = cases[index];
    if (scenario === undefined) {
      return;
    }
    const directory = nodePath.join(scratch, scenario.name);
    await mkdir(directory);
    const dependencies = new Map(Object.entries(tarballs));
    dependencies.set("@monque/core", scenario.core);
    dependencies.set("@monque/management", scenario.management);
    dependencies.set("express", "5.2.1");
    dependencies.set("mongodb", "7.7.0");
    if (scenario.name === "current") {
      dependencies.set("@tsed/core", "8.41.2");
      dependencies.set("@tsed/di", "8.41.2");
      dependencies.set("@tsed/platform-http", "8.41.2");
    } else {
      dependencies.delete("@monque/tsed");
    }
    await writeFile(
      nodePath.join(directory, "package.json"),
      JSON.stringify(
        { private: true, type: "module", dependencies: Object.fromEntries(dependencies) },
        null,
        2,
      ),
    );
    await copyFile(
      nodePath.join(root, "scripts/verification/consumer-app.mts"),
      nodePath.join(directory, "app.mts"),
    );
    await run("bun", ["install", "--ignore-scripts"], directory);
    // Every Monque package must come from this install, even when a workspace is nearby.
    const consumerDirectory = await realpath(directory);
    await Promise.all(
      [...dependencies.keys()]
        .filter((dependencyName) => dependencyName.startsWith("@monque/"))
        .map(async (dependencyName) => {
          const installed = await realpath(
            nodePath.join(directory, "node_modules", dependencyName),
          );
          assert.ok(
            installed.startsWith(`${consumerDirectory}/`),
            `${dependencyName} escaped the consumer install`,
          );
        }),
    );
    await run(process.execPath, ["app.mts"], directory, {
      MONQUE_VERIFY_CASE: scenario.name,
      MONQUE_VERIFY_URI: mongoContainer.getConnectionString(),
      MONQUE_VERIFY_SCRATCH: scratch,
    });
    const result: unknown = JSON.parse(
      await readFile(nodePath.join(directory, "result.json"), "utf-8"),
    );
    results.push(result);
    await verifyCase(index + 1);
  };
  await verifyCase(0);
  const report = {
    checkedAt: new Date().toISOString(),
    runtime: { node: process.version, bun: process.versions.bun },
    packages: versions,
    results,
  };
  await writeFile(
    nodePath.join(reportDirectory, "consumer.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    await container?.stop();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
