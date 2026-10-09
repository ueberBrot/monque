import { randomUUID } from "node:crypto";
import { setTimeout as pauseFor } from "node:timers/promises";
import { MongoClient } from "mongodb";
import type {
  CommandStartedEvent,
  CommandSucceededEvent,
  Document,
  FindOneAndUpdateOptions,
} from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vite-plus/test";

import { Monque } from "@/scheduler";
import { stopMonqueInstances, waitFor } from "@test-utils/test-utils.js";

import { readCommand, readExplanation, readStreamReply } from "./mongo-observations";
import type { StreamNotification } from "./mongo-observations";

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
    for (let i = 0; i < 100; i += 1) {
      monque.register(`worker-${i}`, () => {});
    }
    const discoveryRequests = new Set<number>();
    let discoveries = 0;
    let claims = 0;
    client.on("commandStarted", (event: CommandStartedEvent) => {
      const command = readCommand(event.command);
      if (command.findAndModify === collectionName) {
        claims += 1;
      }
      if (
        command.aggregate === collectionName &&
        command.pipeline?.[0]?.["$changeStream"] === undefined
      ) {
        discoveryRequests.add(event.requestId);
      }
    });
    client.on("commandSucceeded", (event: CommandSucceededEvent) => {
      if (discoveryRequests.has(event.requestId)) {
        discoveries += 1;
      }
    });
    monque.start();
    await waitFor(() => discoveries > 0, { timeout: 2000, interval: 10 });
    expect({
      discoveries,
      claims,
    }).toStrictEqual({
      discoveries: 1,
      claims: 0,
    });
  });

  it("runs persisted future jobs before the safety interval, including after draining due work", async () => {
    const collectionName = "persisted";
    const producer = new Monque(db, { collectionName });
    const consumer = new Monque(db, {
      collectionName,
      pollInterval: 60_000,
      safetyPollInterval: 60_000,
      workerConcurrency: 1,
    });
    instances.push(producer, consumer);
    await producer.initialize();
    await consumer.initialize();
    const handled: string[] = [];
    consumer.register<{
      value: string;
    }>("work", (job) => {
      handled.push(job.data.value);
    });
    consumer.register<{
      value: string;
    }>("future-only", (job) => {
      handled.push(job.data.value);
    });
    const runAt = new Date(Date.now() + 700);
    await producer.enqueue("work", { value: "due" });
    await producer.enqueue("work", { value: "future" }, { runAt });
    await producer.enqueue("future-only", { value: "other" }, { runAt });
    consumer.start();
    await waitFor(() => handled.length === 3, { timeout: 3000, interval: 10 });
    expect(handled).toStrictEqual(expect.arrayContaining(["due", "future", "other"]));
  });

  it("runs a case-variant future job enqueued after startup discovery", async () => {
    const collectionName = "future-collation";
    await db.createCollection(collectionName, { collation: { locale: "en", strength: 2 } });
    const producer = new Monque(db, { collectionName });
    const consumer = new Monque(db, {
      collectionName,
      pollInterval: 60_000,
      safetyPollInterval: 60_000,
    });
    instances.push(producer, consumer);
    await producer.initialize();
    await consumer.initialize();
    const handled: string[] = [];
    consumer.register("email", (job) => {
      handled.push(job.name);
    });
    const startupReads = new Set<number>();
    const subscriptions = new Set<number>();
    let startupFinished = false;
    let subscribed = false;
    client.on("commandStarted", (event: CommandStartedEvent) => {
      const command = readCommand(event.command);
      if (command.find === collectionName) {
        startupReads.add(event.requestId);
      }
      if (
        command.aggregate === collectionName &&
        command.pipeline?.[0]?.["$changeStream"] !== undefined
      ) {
        subscriptions.add(event.requestId);
      }
    });
    client.on("commandSucceeded", (event: CommandSucceededEvent) => {
      if (startupReads.has(event.requestId)) {
        startupFinished = true;
      }
      if (subscriptions.has(event.requestId)) {
        subscribed = true;
      }
    });
    consumer.start();
    await waitFor(() => startupFinished && subscribed, { timeout: 3000, interval: 10 });
    await producer.enqueue("EMAIL", {}, { runAt: new Date(Date.now() + 700) });
    await waitFor(() => handled.length === 1, { timeout: 3000, interval: 10 });
    expect(handled).toStrictEqual(["EMAIL"]);
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
    for (const name of names) {
      consumer.register(name, () => {});
    }
    await producer.enqueueMany(
      names.flatMap((name) => Array.from({ length: 100 }, () => ({ name, data: {}, runAt }))),
    );
    let pipeline: Document[] | undefined;
    client.on("commandStarted", (event: CommandStartedEvent) => {
      const command = readCommand(event.command);
      if (
        command.aggregate === collectionName &&
        command.pipeline?.[0]?.["$changeStream"] === undefined
      ) {
        ({ pipeline } = command);
      }
    });
    consumer.start();
    await waitFor(() => pipeline !== undefined, { timeout: 2000, interval: 10 });
    if (!pipeline) {
      throw new Error("Discovery did not issue its read");
    }
    const explanation = await db
      .collection(collectionName)
      .aggregate(pipeline)
      .explain("executionStats");
    const { stats } = readExplanation(explanation);
    expect(stats.totalKeysExamined).toBeLessThan(100);
    expect(stats.totalDocsExamined).toBe(0);
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
      const release: PromiseWithResolvers<void> = Promise.withResolvers();
      let futureStarted = false;
      consumer.register<{
        hold: boolean;
      }>("work", async (job) => {
        if (job.data.hold) {
          await release.promise;
        } else {
          futureStarted = true;
        }
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
            await pauseFor(Math.max(0, runAt.getTime() - Date.now() + 50));
          }
          return result;
        });
      try {
        consumer.start();
        await waitFor(() => futureStarted, { timeout: 3000, interval: 10 });
        expect(futureStarted).toBe(true);
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
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    let handledPayload: unknown;
    consumer.register("work", async (job) => {
      handledPayload = job.data;
      await release.promise;
    });
    const events: StreamNotification[] = [];
    const watchRequests = new Set<number>();
    let subscribed = false;
    client.on("commandStarted", (event: CommandStartedEvent) => {
      const command = readCommand(event.command);
      if (
        command.aggregate === collectionName &&
        command.pipeline?.[0]?.["$changeStream"] !== undefined
      ) {
        watchRequests.add(event.requestId);
      }
    });
    client.on("commandSucceeded", (event: CommandSucceededEvent) => {
      if (watchRequests.has(event.requestId)) {
        subscribed = true;
      }
      const reply = readStreamReply(event.reply);
      if (reply.cursor?.ns !== `${db.databaseName}.${collectionName}`) {
        return;
      }
      const batch = reply.cursor.firstBatch ?? reply.cursor.nextBatch ?? [];
      events.push(...batch.filter((notification) => notification.operationType !== undefined));
    });
    try {
      consumer.start();
      await waitFor(() => subscribed, { timeout: 3000, interval: 10 });
      const payload = { message: "preserved", large: "x".repeat(10_000) };
      const job = await producer.enqueue("work", payload, {
        runAt: new Date(Date.now() + 60_000),
      });
      await waitFor(() => events.some((event) => event.fullDocument?.name === "work"), {
        timeout: 3000,
        interval: 10,
      });
      await producer.rescheduleJob(job._id.toHexString(), new Date());
      await waitFor(() => handledPayload !== undefined, { timeout: 3000, interval: 10 });
      await producer.enqueue("barrier", {}, { runAt: new Date(Date.now() + 60_000) });
      await waitFor(() => events.some((event) => event.fullDocument?.name === "barrier"), {
        timeout: 3000,
        interval: 10,
      });
      expect({
        handledPayload,
        observed: events.some(
          (event) => event.updateDescription?.updatedFields?.status === "processing",
        ),
        payloadsOmitted: events.every((event) => event.fullDocument?.data === undefined),
      }).toStrictEqual({
        handledPayload: payload,
        observed: false,
        payloadsOmitted: true,
      });
      release.resolve();
      await waitFor(() => events.some((event) => event.fullDocument?.status === "completed"), {
        timeout: 3000,
        interval: 10,
      });
    } finally {
      release.resolve();
    }
  });
});
