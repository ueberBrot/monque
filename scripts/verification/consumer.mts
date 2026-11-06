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
const driver = args.find((arg) => arg.startsWith("--mongodb="))?.slice("--mongodb=".length);

assert.ok(
  args.every((arg) => arg === "--skip-build" || arg.startsWith("--mongodb=")) &&
    (driver === undefined || driver === "6.22.0" || driver === "7.8.0"),
  "Usage: bun scripts/verification/consumer.mts [--skip-build] [--mongodb=6.22.0|7.8.0]",
);

const minimumManagementVersion = "0.11.0";
const esmTypes = "consumer-types.mts";
const cjsTypes = "consumer-types.cts";

const managementExpressManifest = z
  .object({ peerDependencies: z.object({ "@monque/management": z.string() }) })
  .parse(
    JSON.parse(
      await readFile(nodePath.join(root, "packages/management-express/package.json"), "utf-8"),
    ),
  );

assert.equal(
  managementExpressManifest.peerDependencies["@monque/management"].split(" ")[0],
  `>=${minimumManagementVersion}`,
  "Update the minimum-management case to match the adapter's supported peer range",
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
    {
      name: "minimum-core",
      core: "1.16.0",
      management: tarballs["@monque/management"],
      mongodb: "7.8.0",
    },
    {
      name: "minimum-management",
      core: tarballs["@monque/core"],
      management: minimumManagementVersion,
      mongodb: "7.8.0",
    },
    {
      name: "current",
      core: tarballs["@monque/core"],
      management: tarballs["@monque/management"],
      mongodb: "7.8.0",
    },
    {
      name: "mongodb-6",
      core: tarballs["@monque/core"],
      management: tarballs["@monque/management"],
      mongodb: "6.22.0",
    },
  ].filter((scenario) => driver === undefined || scenario.mongodb === driver);

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
    dependencies.set("mongodb", scenario.mongodb);
    dependencies.set("@types/node", "^22.20.5");
    dependencies.set("@types/express", "^5.0.6");
    dependencies.set("@opentelemetry/api", "^1.9.0");
    dependencies.set("rxjs", "^7.8.2");

    if (scenario.name === "current" || scenario.name === "mongodb-6") {
      dependencies.set("@tsed/core", "8.41.2");
      dependencies.set("@tsed/di", "8.41.2");
      dependencies.set("@tsed/platform-http", "8.41.2");

      if (scenario.name === "current") {
        dependencies.set("@tsed/mongoose", "8.41.2");
        dependencies.set("mongoose", "9.12.0");
      }
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
    await Promise.all(
      ["consumer-mongodb.mts", esmTypes, cjsTypes].map(async (filename) => {
        await copyFile(
          nodePath.join(root, "scripts/verification", filename === cjsTypes ? esmTypes : filename),
          nodePath.join(directory, filename),
        );
      }),
    );
    await run("bun", ["install", "--ignore-scripts"], directory);
    // Every Monque package must come from this install, even when a workspace is nearby.
    const consumerDirectory = await realpath(directory);
    await Promise.all(
      dependencies
        .keys()
        .filter((dependencyName) => dependencyName.startsWith("@monque/"))
        .map(async (dependencyName) => {
          const installed = await realpath(
            nodePath.join(directory, "node_modules", dependencyName),
          );

          assert.ok(
            installed.startsWith(`${consumerDirectory}/`),
            `${dependencyName} escaped the consumer install`,
          );
        })
        .toArray(),
    );

    if (scenario.name === "current" || scenario.name === "mongodb-6") {
      await run(
        "node",
        [
          nodePath.join(root, "node_modules/typescript/bin/tsc"),
          "--noEmit",
          "--strict",
          "--module",
          "nodenext",
          "--target",
          "es2023",
          "--types",
          "node",
          esmTypes,
          cjsTypes,
        ],
        directory,
      );
    }

    await run("node", ["app.mts"], directory, {
      MONQUE_VERIFY_CASE: scenario.name,
      MONQUE_VERIFY_URI: mongoContainer.getConnectionString(),
      MONQUE_VERIFY_SCRATCH: scratch,
      MONQUE_VERIFY_MONGODB: scenario.mongodb,
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
    orchestrator: { bun: process.versions.bun },
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
