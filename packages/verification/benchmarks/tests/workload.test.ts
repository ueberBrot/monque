import type { CommandStartedEvent } from "mongodb";
import { MongoClient } from "mongodb";
import { describe, expect, it } from "vite-plus/test";

import { runBenchmark } from "../workload.mts";

describe("benchmark", () => {
  it("measures public processing and Dashboard reads and removes only its isolated dataset", async () => {
    const client = new MongoClient(
      process.env.MONQUE_BENCH_URI ?? "mongodb://127.0.0.1:27017/?directConnection=true",
      { monitorCommands: true },
    );

    await client.connect();

    try {
      const report = await runBenchmark(client, {
        jobs: 6,
        history: 30,
        warmup: 1,
        repetitions: 2,
        instances: 2,
        workerConcurrency: 2,
        instanceConcurrency: 2,
        payloadBytes: 32,
        pollIntervalMs: 20,
        pollingRounds: 3,
        pollingIntervalMs: 1,
      });

      expect(
        report.processing.map((sample) => ({
          completed: sample.completed,
          starts: sample.enqueueToStartMs.count,
          measuredCommands: sample.commands.total > 0,
        })),
      ).toStrictEqual([
        { completed: 6, starts: 6, measuredCommands: true },
        { completed: 6, starts: 6, measuredCommands: true },
      ]);
      expect(
        report.polling.map((sample) => ({
          requests: sample.requests.length,
          measuredResponses: sample.requests.every((request) => request.bytes > 0),
        })),
      ).toStrictEqual([
        { requests: 6, measuredResponses: true },
        { requests: 6, measuredResponses: true },
      ]);
      expect({ dataset: report.dataset, polling: report.polling[0] }).toMatchObject({
        dataset: { completed: 30 },
        polling: {
          byPath: {
            "jobs?view=summary&limit=50&sortBy=createdAt&sortDirection=desc": {
              latencyMs: { count: 3 },
            },
            capabilities: { latencyMs: { count: 1 } },
            "queue-views": { latencyMs: { count: 1 } },
            health: { latencyMs: { count: 1 } },
          },
        },
      });
      await expect(
        client.db(report.databaseName).listCollections().toArray(),
      ).resolves.toStrictEqual([]);
      await expect(client.db("admin").command({ ping: 1 })).resolves.toHaveProperty("ok", 1);
    } finally {
      await client.close();
    }
  });

  it("drops its dataset after intake fails and leaves the borrowed client usable", async () => {
    const client = new MongoClient(
      process.env.MONQUE_BENCH_URI ?? "mongodb://127.0.0.1:27017/?directConnection=true",
      { monitorCommands: true },
    );

    const databases = new Set<string>();

    const observe = (event: CommandStartedEvent) => {
      if (event.databaseName.startsWith("monque_benchmark_")) {
        databases.add(event.databaseName);
      }
    };

    client.on("commandStarted", observe);
    await client.connect();

    try {
      await expect(
        runBenchmark(client, { jobs: 1, history: 1, payloadBytes: 17_000_000 }),
      ).rejects.toThrow(/too large/iu);
      expect(databases.size).toBe(1);

      const [databaseName] = [...databases];
      await expect(client.db(databaseName).listCollections().toArray()).resolves.toStrictEqual([]);

      expect(client.listeners("commandStarted")).toStrictEqual([observe]);
      await expect(client.db("admin").command({ ping: 1 })).resolves.toHaveProperty("ok", 1);
    } finally {
      client.off("commandStarted", observe);
      await client.close();
    }
  });
});
