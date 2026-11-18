import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import { MongoDBContainer } from "@testcontainers/mongodb";
import { assert, it, describe } from "vitest";
import { z } from "zod";

import { packRelease } from "../../scripts/verification/pack-release.mts";

describe("isolated package consumption", () => {
  it("packed package compatibility matrix", async () => {
    const root = nodePath.resolve(import.meta.dirname, "../..");

    const packageNames = [
      "core",
      "management",
      "management-express",
      "dashboard",
      "dashboard-express",
      "tsed",
    ];

    const driver = process.env.MONQUE_VERIFY_MONGODB;
    assert.ok(
      driver === undefined || driver === "6.22.0" || driver === "7.8.0",
      "Unsupported MongoDB version",
    );

    const minimumManagementVersion = "0.12.0";

    const effectConsumer = "effect-consumer.test.mts";
    const esmTypes = "consumer-types.mts";
    const cjsTypes = "consumer-types.cts";

    const managementExpressManifest = z
      .object({ peerDependencies: z.object({ "@monque/management": z.string() }) })
      .parse(
        JSON.parse(
          await readFile(nodePath.join(root, "packages/management-express/package.json"), "utf-8"),
        ),
      );

    assert.strictEqual(
      managementExpressManifest.peerDependencies["@monque/management"].split(" ")[0],
      `>=${minimumManagementVersion}`,
      "Update the minimum-management case to match the adapter's supported peer range",
    );

    const cancellation = new AbortController();

    const signalHandlers = ["SIGINT", "SIGTERM"].map((signal) => ({
      signal,
      handler: () => {
        cancellation.abort(new Error(`Received ${signal}`));
      },
    }));

    for (const { signal, handler } of signalHandlers) {
      process.once(signal, handler);
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

    const verifyNativeConsumer = async (directory: string, uri: string): Promise<void> => {
      await copyFile(
        nodePath.join(import.meta.dirname, effectConsumer),
        nodePath.join(directory, effectConsumer),
      );
      await run("node", ["node_modules/vitest/vitest.mjs", "run", effectConsumer], directory, {
        MONQUE_VERIFY_URI: uri,
      });
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
    };

    const scratch = await mkdtemp(nodePath.join(tmpdir(), "monque-consumer-"));
    const reportDirectory = nodePath.join(root, ".verification");

    await mkdir(reportDirectory, { recursive: true });

    await rm(nodePath.join(reportDirectory, "consumer.json"), { force: true });

    let container: StartedMongoDBContainer | undefined;

    try {
      const tarballs = await packRelease(root, packageNames, scratch);

      const versions = Object.fromEntries(
        await Promise.all(
          packageNames.map(async (name) => {
            const manifest = packageManifestSchema.parse(
              JSON.parse(
                await readFile(nodePath.join(scratch, "release", name, "package.json"), "utf-8"),
              ),
            );

            return [manifest.name, manifest.version] as const;
          }),
        ),
      );

      // Before the minimum is published, the matching candidate supplies that case.
      const minimumManagement =
        versions["@monque/management"] === minimumManagementVersion
          ? tarballs["@monque/management"]
          : minimumManagementVersion;

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
          management: minimumManagement,
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
        dependencies.set("@orpc/client", "2.0.0-beta.51");
        dependencies.set("vitest", "5.1.0");
        dependencies.set("@effect/vitest", "4.1.4");
        dependencies.set("express", "5.2.1");
        dependencies.set("effect", "4.1.4");
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
            {
              private: true,
              type: "module",
              dependencies: Object.fromEntries(dependencies),
              // Resolve transitive Monque imports to the same packages as the scenario.
              overrides: Object.fromEntries(
                dependencies.entries().filter(([name]) => name.startsWith("@monque/")),
              ),
            },
            null,
            2,
          ),
        );
        await copyFile(
          nodePath.join(import.meta.dirname, "consumer-app.test.mts"),
          nodePath.join(directory, "consumer-app.test.mts"),
        );
        await Promise.all(
          ["consumer-mongodb.mts", esmTypes, cjsTypes].map(async (filename) => {
            await copyFile(
              nodePath.join(import.meta.dirname, filename === cjsTypes ? esmTypes : filename),
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
          await verifyNativeConsumer(directory, mongoContainer.getConnectionString());
        }

        await run(
          "node",
          ["node_modules/vitest/vitest.mjs", "run", "consumer-app.test.mts"],
          directory,
          {
            MONQUE_VERIFY_CASE: scenario.name,
            MONQUE_VERIFY_URI: mongoContainer.getConnectionString(),
            MONQUE_VERIFY_SCRATCH: scratch,
            MONQUE_VERIFY_MONGODB: scenario.mongodb,
          },
        );

        const result: unknown = JSON.parse(
          await readFile(nodePath.join(directory, "result.json"), "utf-8"),
        );

        results.push(result);
        await verifyCase(index + 1);
      };

      await verifyCase(0);

      const report = {
        checkedAt: new Date().toISOString(),
        orchestrator: { node: process.versions.node },
        packages: versions,
        results,
      };

      await writeFile(
        nodePath.join(reportDirectory, "consumer.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      console.log(JSON.stringify(report, null, 2));
    } finally {
      for (const { signal, handler } of signalHandlers) {
        process.off(signal, handler);
      }

      try {
        await container?.stop();
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }
  }, 600_000);
});
