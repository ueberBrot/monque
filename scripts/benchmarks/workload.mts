/* oxlint-disable no-await-in-loop -- Sequential phases and requests define the measured workload. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Monque } from "@monque/core";
import { createManagementSurface } from "@monque/management";
import type { CommandStartedEvent, Db, MongoClient } from "mongodb";
import { z } from "zod";

const positiveInteger = z.number().int().positive();

export const benchmarkOptionsSchema = z.strictObject({
  jobs: positiveInteger.default(1000),
  history: positiveInteger.default(100_000),
  warmup: z.number().int().nonnegative().default(1),
  repetitions: positiveInteger.default(3),
  instances: positiveInteger.default(1),
  workerConcurrency: positiveInteger.default(10),
  instanceConcurrency: positiveInteger.default(10),
  payloadBytes: z.number().int().nonnegative().default(256),
  pollIntervalMs: positiveInteger.default(100),
  pollingRounds: positiveInteger.default(6),
  pollingIntervalMs: positiveInteger.default(1000),
});

const distribution = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);

  const percentile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;

  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) ?? 0,
  };
};

type Options = z.output<typeof benchmarkOptionsSchema>;

interface Meter {
  reset: () => void;
  snapshot: () => { byName: Record<string, number>; total: number };
}

const measureProcessing = async (db: Db, instances: Monque[], options: Options, meter: Meter) => {
  const [producer] = instances;

  if (producer === undefined) {
    throw new Error("At least one Scheduler Instance is required");
  }

  const payload = "x".repeat(options.payloadBytes);
  const processing = [];
  let activeLatencies: number[] = [];
  let completed = 0;
  let errors: Error[] = [];

  const onComplete = () => {
    completed += 1;
  };

  const onError = ({ error }: { error: Error }) => {
    errors.push(error);
  };

  const handler = async (job: { data: { enqueuedAt: number; payload: string } }) => {
    activeLatencies.push(performance.now() - job.data.enqueuedAt);
    await Promise.resolve();
  };

  for (const monque of instances) {
    monque.register("benchmark-work", handler);
    monque.on("job:complete", onComplete);
    monque.on("job:error", onError);
    monque.on("job:fail", onError);
    monque.start();
  }

  for (let repetition = -options.warmup; repetition < options.repetitions; repetition += 1) {
    await db.collection("jobs").deleteMany({});
    activeLatencies = [];
    completed = 0;
    errors = [];
    meter.reset();
    const started = performance.now();

    // Sequential public enqueue calls: latency includes the acknowledged write and queue wait.
    for (let index = 0; index < options.jobs; index += 1) {
      await producer.enqueue("benchmark-work", { enqueuedAt: performance.now(), payload });
    }

    const intakeMs = performance.now() - started;
    const deadline = performance.now() + 60_000;

    while (completed < options.jobs && errors.length === 0 && performance.now() < deadline) {
      await delay(5);
    }

    assert.equal(errors.length, 0, errors.map(String).join("\n"));
    assert.equal(completed, options.jobs, "Processing did not complete within 60 seconds");
    assert.equal(activeLatencies.length, options.jobs, "Each Job must start exactly once");
    const elapsedMs = performance.now() - started;
    const operations = meter.snapshot();

    if (repetition >= 0) {
      processing.push({
        completed,
        intakeMs,
        elapsedMs,
        intakeJobsPerSecond: (options.jobs * 1000) / intakeMs,
        jobsPerSecond: (completed * 1000) / elapsedMs,
        enqueueToStartMs: distribution(activeLatencies),
        commands: operations,
        commandsPerJob: operations.total / completed,
      });
    }
  }

  return processing;
};

const pollingPaths = (round: number) => {
  // Visible jobs page: list each tick, capabilities every 6 ticks; Queue View and health every 3.
  const paths = ["jobs?view=summary&limit=50&sortBy=createdAt&sortDirection=desc"];

  if (round % 6 === 0) {
    paths.push("capabilities");
  }

  if (round % 3 === 0) {
    paths.push("queue-views", "health");
  }

  return paths;
};

const measurePolling = async (producer: Monque, options: Options, meter: Meter) => {
  const { openApiHandler } = createManagementSurface({ monque: producer, readOnly: true });
  const polling = [];

  for (let repetition = -options.warmup; repetition < options.repetitions; repetition += 1) {
    meter.reset();
    const requests = [];

    for (let round = 0; round < options.pollingRounds; round += 1) {
      const paths = pollingPaths(round);

      for (const path of paths) {
        const started = performance.now();
        const before = meter.snapshot().total;

        const result = await openApiHandler.handle(new Request(`http://benchmark/api/v1/${path}`));

        assert.ok(result.matched);
        assert.equal(result.response.status, 200, path);
        const body = await result.response.text();
        requests.push({
          path,
          latencyMs: performance.now() - started,
          bytes: Buffer.byteLength(body),
          commands: meter.snapshot().total - before,
        });
      }

      if (round + 1 < options.pollingRounds) {
        await delay(options.pollingIntervalMs);
      }
    }

    if (repetition >= 0) {
      polling.push({
        requests,
        latencyMs: distribution(requests.map((request) => request.latencyMs)),
        responseBytes: distribution(requests.map((request) => request.bytes)),
        commands: meter.snapshot(),
        byPath: Object.fromEntries(
          [...Map.groupBy(requests, (request) => request.path)].map(([path, samples]) => [
            path,
            {
              latencyMs: distribution(samples.map((sample) => sample.latencyMs)),
              responseBytes: distribution(samples.map((sample) => sample.bytes)),
              commands: samples.reduce((total, sample) => total + sample.commands, 0),
            },
          ]),
        ),
      });
    }
  }

  return polling;
};

export const runBenchmark = async (
  client: MongoClient,
  input: z.input<typeof benchmarkOptionsSchema> = {},
) => {
  const options = benchmarkOptionsSchema.parse(input);

  assert.equal(
    client.options.monitorCommands,
    true,
    "Enable MongoClient monitorCommands for operation counts",
  );
  // The caller cannot choose a database to drop. Every run owns a fresh database.
  const databaseName = `monque_benchmark_${randomUUID().replaceAll("-", "")}`;
  const db = client.db(databaseName);
  let counts: Record<string, number> = {};

  const observe = (event: CommandStartedEvent) => {
    if (event.databaseName === databaseName) {
      counts[event.commandName] = (counts[event.commandName] ?? 0) + 1;
    }
  };

  const commands = () => ({
    byName: { ...counts },
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  });

  const instances: Monque[] = [];
  client.on("commandStarted", observe);
  const setupStarted = performance.now();

  try {
    for (let index = 0; index < options.instances; index += 1) {
      const monque = new Monque(db, {
        collectionName: "jobs",
        schedulerInstanceId: `benchmark-${index}`,
        workerConcurrency: options.workerConcurrency,
        instanceConcurrency: options.instanceConcurrency,
        pollInterval: options.pollIntervalMs,
        safetyPollInterval: options.pollIntervalMs,
      });

      instances.push(monque);
      await monque.initialize();
    }

    const [producer] = instances;

    if (producer === undefined) {
      throw new Error("At least one Scheduler Instance is required");
    }

    const setupMs = performance.now() - setupStarted;

    const meter = {
      reset: () => {
        counts = {};
      },
      snapshot: commands,
    };

    const processing = await measureProcessing(db, instances, options, meter);
    await Promise.all(
      instances.map(async (monque) => {
        await monque.stop();
      }),
    );
    const preparationStarted = performance.now();
    await db.collection("jobs").deleteMany({});
    const timestamp = new Date("2026-01-01T00:00:00Z");

    for (let offset = 0; offset < options.history; offset += 1000) {
      await db.collection("jobs").insertMany(
        Array.from({ length: Math.min(1000, options.history - offset) }, (_, index) => ({
          name: `history-${(offset + index) % 10}`,
          data: { payload: "x".repeat(options.payloadBytes) },
          status: "completed",
          failCount: 0,
          priority: 0,
          nextRunAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        })),
      );
    }

    const stats = await producer.getQueueStats();

    assert.equal(
      stats.completed,
      options.history,
      "History preparation must preserve dataset size",
    );
    const preparationMs = performance.now() - preparationStarted;
    const polling = await measurePolling(producer, options, meter);

    return {
      databaseName,
      options,
      setupMs,
      preparationMs,
      processing,
      polling,
      dataset: {
        completed: stats.completed,
        jobNames: 10,
        payloadStringBytes: options.payloadBytes,
        timestamps: timestamp.toISOString(),
      },
    };
  } finally {
    try {
      await Promise.all(
        instances.map(async (monque) => {
          await monque.dispose();
        }),
      );
      await db.dropDatabase();
    } finally {
      client.off("commandStarted", observe);
    }
  }
};
