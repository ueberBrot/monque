import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { MongoClient } from "mongodb";
import { z } from "zod";

import { benchmarkOptionsSchema, runBenchmark } from "./workload.mts";

const git = (...args: string[]) => execFileSync("/usr/bin/git", args, { encoding: "utf-8" }).trim();

const uri = process.env.MONQUE_BENCH_URI;

if (uri === undefined) {
  throw new Error("Set MONQUE_BENCH_URI to a local benchmark MongoDB server");
}

const input: unknown =
  process.argv[2] === undefined ? {} : JSON.parse(await readFile(process.argv[2], "utf-8"));

const client = new MongoClient(uri, { monitorCommands: true, serverSelectionTimeoutMS: 10_000 });

try {
  await client.connect();

  const build = z
    .object({ version: z.string(), gitVersion: z.string() })
    .parse(await client.db("admin").command({ buildInfo: 1 }));

  const topology = z
    .object({
      setName: z.string().optional(),
      isWritablePrimary: z.boolean(),
      maxWireVersion: z.number(),
    })
    .parse(await client.db("admin").command({ hello: 1 }));

  const result = await runBenchmark(client, benchmarkOptionsSchema.parse(input));

  console.log(
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        revision: git("rev-parse", "HEAD"),
        dirty: git("status", "--porcelain") !== "",
        environment: {
          topology,
          node: process.version,
          runtime: process.versions,
          platform: platform(),
          osRelease: release(),
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
          memoryBytes: totalmem(),
          mongodb: build,
          driver: "7.8.0",
          connection: "caller-supplied; URI omitted",
          commandMonitoring: true,
        },
        ...result,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
