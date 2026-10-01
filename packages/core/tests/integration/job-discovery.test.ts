import { randomUUID } from "node:crypto";
import {
  type CommandStartedEvent,
  type CommandSucceededEvent,
  type Document,
  type FindOneAndUpdateOptions,
  MongoClient,
} from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vite-plus/test";

import { Monque } from "@/scheduler";
import { stopMonqueInstances, waitFor } from "@test-utils/test-utils.js";

interface StreamNotification {
  operationType?: string;
  fullDocument?: { name?: string; status?: string; nextRunAt?: Date; data?: unknown };
  updateDescription?: { updatedFields?: { status?: string } };
}

describe("job discovery", () => {
  const client = new MongoClient(inject("coreMongoUri"), {
    directConnection: true,
    monitorCommands: true,
  });
  const db = client.db(`monque_discovery_${randomUUID().replaceAll("-", "")}`);
  const instances: Monque[] = [];

  beforeAll(async () => {
    await client.connect();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await stopMonqueInstances(instances);
    client.removeAllListeners("commandStarted");
    client.removeAllListeners("commandSucceeded");
  });

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it("discovers an idle collection without per-name atomic write commands", async () => {
    const collectionName = "idle";
    const monque = new Monque(db, { collectionName, safetyPollInterval: 60_000 });
    instances.push(monque);
    await monque.initialize();
    for (let i = 0; i < 100; i++) monque.register(`worker-${i}`, async () => {});

    const discoveryRequests = new Set<number>();
    let discoveries = 0;
    let claims = 0;
    client.on("commandStarted", (event: CommandStartedEvent) => {
      if (event.command["findAndModify"] === collectionName) claims++;
      if (
        event.command["aggregate"] === collectionName &&
        !event.command["pipeline"][0]?.["$changeStream"]
      ) {
        discoveryRequests.add(event.requestId);
      }
    });
    client.on("commandSucceeded", (event: CommandSucceededEvent) => {
      if (discoveryRequests.has(event.requestId)) discoveries++;
    });

    monque.start();
    await waitFor(async () => discoveries > 0, { timeout: 2000, interval: 10 });
    expect(discoveries).toBe(1);
    expect(claims).toBe(0);
  });

  it("runs persisted future jobs before the safety interval, including after draining due work", async () => {
    const collectionName = "persisted";
    const producer = new Monque(db, { collectionName });
    const consumer = new Monque(db, {
      collectionName,
      pollInterval: 60_000,
      safetyPollInterval: 60_000,
      defaultConcurrency: 1,
    });
    instances.push(producer, consumer);
    await producer.initialize();
    await consumer.initialize();
    const handled: string[] = [];
    consumer.register<{ value: string }>("work", async (job) => {
      handled.push(job.data.value);
    });
    consumer.register<{ value: string }>("future-only", async (job) => {
      handled.push(job.data.value);
    });
    const runAt = new Date(Date.now() + 700);
    await producer.enqueue("work", { value: "due" });
    await producer.enqueue("work", { value: "future" }, { runAt });
    await producer.enqueue("future-only", { value: "other" }, { runAt });

    consumer.start();
    await waitFor(async () => handled.length === 3, { timeout: 3000, interval: 10 });
    expect(handled).toEqual(expect.arrayContaining(["due", "future", "other"]));
  });

  it("reads deadlines without scanning every pending job in each name", async () => {
    const collectionName = "backlog";
    const producer = new Monque(db, { collectionName });
    const consumer = new Monque(db, { collectionName, safetyPollInterval: 60_000 });
    instances.push(producer, consumer);
    await producer.initialize();
    await consumer.initialize();
    const names = Array.from({ length: 10 }, (_, i) => `worker-${i}`);
    const runAt = new Date(Date.now() + 3_600_000);
    for (const name of names) consumer.register(name, async () => {});
    await producer.enqueueMany(
      names.flatMap((name) => Array.from({ length: 100 }, () => ({ name, data: {}, runAt }))),
    );
    let pipeline: Document[] | undefined;
    client.on("commandStarted", (event: CommandStartedEvent) => {
      if (
        event.command["aggregate"] === collectionName &&
        !event.command["pipeline"][0]?.["$changeStream"]
      ) {
        pipeline = event.command["pipeline"];
      }
    });
    consumer.start();
    await waitFor(async () => pipeline !== undefined, { timeout: 2000, interval: 10 });
    if (!pipeline) throw new Error("Discovery did not issue its read");
    const explanation = await db
      .collection(collectionName)
      .aggregate(pipeline)
      .explain("executionStats");
    const stats =
      explanation["executionStats"] ?? explanation["stages"]?.[0]?.["$cursor"]?.["executionStats"];
    expect(stats["totalKeysExamined"]).toBeLessThan(100);
    expect(stats["totalDocsExamined"]).toBe(0);
  });

  it.each([false, true])(
    "wakes a persisted job with a free slot, deadline passes during claim: %s",
    async (crossesDeadline) => {
      const collectionName = `available-slot-${crossesDeadline}`;
      const producer = new Monque(db, { collectionName });
      const consumer = new Monque(db, {
        collectionName,
        pollInterval: 60_000,
        safetyPollInterval: 60_000,
        workerConcurrency: 2,
      });
      instances.push(producer, consumer);
      await producer.initialize();
      const collection = db.collection(collectionName);
      const getCollection = vi.spyOn(db, "collection").mockReturnValue(collection);
      await consumer.initialize();
      getCollection.mockRestore();
      const release = Promise.withResolvers<void>();
      let futureStarted = false;
      consumer.register<{ hold: boolean }>("work", async (job) => {
        if (job.data.hold) await release.promise;
        else futureStarted = true;
      });
      const runAt = new Date(Date.now() + 700);
      await producer.enqueue("work", { hold: true });
      await producer.enqueue("work", { hold: false }, { runAt });
      const originalClaim = collection.findOneAndUpdate.bind(collection);
      const claim = vi
        .spyOn(collection, "findOneAndUpdate")
        .mockImplementation(async (filter, update, options: FindOneAndUpdateOptions = {}) => {
          const result = await originalClaim(filter, update, {
            ...options,
            includeResultMetadata: false,
          });
          if (!result && crossesDeadline) {
            await new Promise((resolve) =>
              setTimeout(resolve, Math.max(0, runAt.getTime() - Date.now() + 50)),
            );
          }
          return result;
        });
      try {
        consumer.start();
        await waitFor(async () => futureStarted, { timeout: 3000, interval: 10 });
      } finally {
        release.resolve();
        claim.mockRestore();
      }
    },
  );

  it("filters claim notifications and job payloads while retaining remote scheduling and terminal wakeups", async () => {
    const collectionName = "stream";
    const producer = new Monque(db, { collectionName });
    const consumer = new Monque(db, {
      collectionName,
      pollInterval: 60_000,
      safetyPollInterval: 60_000,
    });
    instances.push(producer, consumer);
    await producer.initialize();
    await consumer.initialize();
    const release = Promise.withResolvers<void>();
    let handledPayload: unknown;
    consumer.register("work", async (job) => {
      handledPayload = job.data;
      await release.promise;
    });

    const events: StreamNotification[] = [];
    const watchRequests = new Set<number>();
    let subscribed = false;
    client.on("commandStarted", (event: CommandStartedEvent) => {
      if (
        event.command["aggregate"] === collectionName &&
        event.command["pipeline"][0]?.["$changeStream"]
      ) {
        watchRequests.add(event.requestId);
      }
    });
    client.on("commandSucceeded", (event: CommandSucceededEvent) => {
      if (watchRequests.has(event.requestId)) subscribed = true;
      const reply = event.reply as {
        cursor?: {
          ns?: string;
          firstBatch?: StreamNotification[];
          nextBatch?: StreamNotification[];
        };
      };
      if (reply.cursor?.ns !== `${db.databaseName}.${collectionName}`) return;
      const batch = reply.cursor.firstBatch ?? reply.cursor.nextBatch ?? [];
      events.push(...batch.filter((notification) => notification.operationType !== undefined));
    });

    try {
      consumer.start();
      await waitFor(async () => subscribed, { timeout: 3000, interval: 10 });
      const payload = { message: "preserved", large: "x".repeat(10_000) };
      const job = await producer.enqueue("work", payload, {
        runAt: new Date(Date.now() + 60_000),
      });
      await waitFor(async () => events.some((event) => event.fullDocument?.name === "work"), {
        timeout: 3000,
        interval: 10,
      });
      await producer.rescheduleJob(job._id.toHexString(), new Date());
      await waitFor(async () => handledPayload !== undefined, { timeout: 3000, interval: 10 });
      await producer.enqueue("barrier", {}, { runAt: new Date(Date.now() + 60_000) });
      await waitFor(async () => events.some((event) => event.fullDocument?.name === "barrier"), {
        timeout: 3000,
        interval: 10,
      });

      expect(handledPayload).toEqual(payload);
      expect(
        events.some((event) => event.updateDescription?.updatedFields?.status === "processing"),
      ).toBe(false);
      expect(events.every((event) => event.fullDocument?.data === undefined)).toBe(true);

      release.resolve();
      await waitFor(
        async () => events.some((event) => event.fullDocument?.status === "completed"),
        { timeout: 3000, interval: 10 },
      );
    } finally {
      release.resolve();
    }
  });
});
