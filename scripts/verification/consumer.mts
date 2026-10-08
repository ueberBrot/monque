import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoDBContainer } from "@testcontainers/mongodb";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageNames = [
  "core",
  "management",
  "management-express",
  "dashboard",
  "dashboard-express",
  "tsed",
];
const args = process.argv.slice(2);
assert(
  args.every((arg) => arg === "--skip-build"),
  "Usage: bun scripts/verification/consumer.mts [--skip-build]",
);

const cancellation = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => cancellation.abort(new Error(`Received ${signal}`)));
}

async function run(
  command: string,
  commandArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
) {
  cancellation.signal.throwIfAborted();
  await new Promise<void>((resolveRun, reject) => {
    const useProcessGroup = process.platform !== "win32";
    const child = spawn(command, commandArgs, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
      detached: useProcessGroup,
    });
    let failure: unknown;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    function kill(signal: NodeJS.Signals) {
      if (!child.pid) return;
      try {
        if (useProcessGroup) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
          failure ??= error;
      }
    }
    function stop(reason: unknown) {
      failure ??= reason;
      kill("SIGTERM");
      escalation ??= setTimeout(() => kill("SIGKILL"), 2_000);
    }
    const onAbort = () => stop(cancellation.signal.reason);
    const timeout = setTimeout(() => stop(new Error(`${command} exceeded ten minutes`)), 600_000);
    cancellation.signal.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      failure ??= error;
    });
    child.once("close", (code, signal) => {
      // Stop descendants before deleting their install or shutting down MongoDB.
      if (failure) kill("SIGKILL");
      clearTimeout(timeout);
      clearTimeout(escalation);
      cancellation.signal.removeEventListener("abort", onAbort);
      if (failure) reject(failure);
      else if (code === 0) resolveRun();
      else reject(new Error(`${command} ${commandArgs.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

const scratch = await mkdtemp(join(tmpdir(), "monque-consumer-"));
const reportDirectory = join(root, ".verification");
await mkdir(reportDirectory, { recursive: true });
await rm(join(reportDirectory, "consumer.json"), { force: true });
let container;
try {
  if (!args.includes("--skip-build"))
    await run("vp", ["run", "--filter", "./packages/*", "build"], root);
  const tarballs: Record<string, string> = {};
  const versions: Record<string, string> = {};
  for (const name of packageNames) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    versions[manifest.name] = manifest.version;
    const tarball = join(scratch, `${name}.tgz`);
    await run(
      "bun",
      ["pm", "pack", "--filename", tarball, "--ignore-scripts", "--quiet"],
      directory,
    );
    tarballs[manifest.name] = tarball;
  }

  const cases = [
    // 1.15.1 was never published; 1.16.0 is the first release satisfying ^1.15.1.
    { name: "minimum-core", core: "1.16.0", management: tarballs["@monque/management"] },
    { name: "minimum-management", core: tarballs["@monque/core"], management: "0.8.0" },
    { name: "current", core: tarballs["@monque/core"], management: tarballs["@monque/management"] },
  ];
  container = await new MongoDBContainer("mongo:8").start();
  const results = [];
  for (const scenario of cases) {
    const directory = join(scratch, scenario.name);
    await mkdir(directory);
    const dependencies: Record<string, string> = {
      ...tarballs,
      "@monque/core": scenario.core,
      "@monque/management": scenario.management,
      express: "5.2.1",
      mongodb: "7.7.0",
    };
    if (scenario.name === "current") {
      Object.assign(dependencies, {
        "@tsed/core": "8.41.2",
        "@tsed/di": "8.41.2",
        "@tsed/platform-http": "8.41.2",
      });
    } else {
      delete dependencies["@monque/tsed"];
    }
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module", dependencies }, null, 2),
    );
    await copyFile(join(root, "scripts/verification/consumer-app.mts"), join(directory, "app.mts"));
    await run("bun", ["install", "--ignore-scripts"], directory);
    // Every Monque package must come from this install, even when a workspace is nearby.
    for (const name of Object.keys(dependencies).filter((name) => name.startsWith("@monque/"))) {
      const installed = await realpath(join(directory, "node_modules", name));
      assert(
        installed.startsWith(`${await realpath(directory)}/`),
        `${name} escaped the consumer install`,
      );
    }
    await run(process.execPath, ["app.mts"], directory, {
      MONQUE_VERIFY_CASE: scenario.name,
      MONQUE_VERIFY_URI: container.getConnectionString(),
      MONQUE_VERIFY_SCRATCH: scratch,
    });
    results.push(JSON.parse(await readFile(join(directory, "result.json"), "utf8")));
  }
  const report = {
    checkedAt: new Date().toISOString(),
    runtime: { node: process.version, bun: process.versions.bun },
    packages: versions,
    results,
  };
  await writeFile(join(reportDirectory, "consumer.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    await container?.stop();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
