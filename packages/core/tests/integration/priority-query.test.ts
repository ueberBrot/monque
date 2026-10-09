import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import type { CommandStartedEvent, Document } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vite-plus/test";

import { Monque } from "@/scheduler";
import { stopMonqueInstances, waitFor } from "@test-utils/test-utils.js";

import { forEachSequential } from "./helpers";
import { readCommand, readExplanation } from "./mongo-observations";

describe("priority query costs", () => {
  const client = new MongoClient(inject("coreMongoUri"), {
    directConnection: true,
    monitorCommands: true,
  });
  const db = client.db(`monque_priority_queries_${randomUUID().replaceAll("-", "")}`);
  const instances: Monque[] = [];
  beforeAll(async () => {
    await client.connect();
  });
  afterEach(async () => {
    await stopMonqueInstances(instances);
    client.removeAllListeners("commandStarted");
  });

  afterAll(async () => {
    await db.dropDatabase();
    await client.close();
  });

  it.each([
    { distinctPriorities: false, managedLegacyIndex: false },
    { distinctPriorities: true, managedLegacyIndex: false },
    { distinctPriorities: true, managedLegacyIndex: true },
  ])(
    "keeps due claims and discovery indexed (distinct priorities: $distinctPriorities, managed legacy index: $managedLegacyIndex)",
    async ({ distinctPriorities, managedLegacyIndex }) => {
      const collectionName = `backlog-${distinctPriorities}-${managedLegacyIndex}`;
      if (managedLegacyIndex) {
        await db.collection(collectionName).createIndex({
          name: 1,
          status: 1,
          nextRunAt: 1,
          claimedBy: 1,
        });
      }
      const producer = new Monque(db, {
        collectionName,
        skipIndexCreation: managedLegacyIndex,
      });
      const consumer = new Monque(db, {
        collectionName,
        skipIndexCreation: managedLegacyIndex,
        workerConcurrency: 1,
        instanceConcurrency: 1,
        safetyPollInterval: 60_000,
      });
      instances.push(producer, consumer);
      await producer.initialize();
      await consumer.initialize();
      const handled: string[] = [];
      consumer.register<{
        label: string;
      }>("work", (job) => {
        handled.push(job.data.label);
        consumer.pause();
      });
      const overdue = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 3_600_000);
      await forEachSequential(
        Array.from({ length: Math.ceil(1000 / 50) }, (_, index) => index * 50),
        async (offset) => {
          await Promise.all(
            Array.from(
              { length: 50 },
              async (_, index) =>
                await producer.enqueue(
                  "work",
                  { label: "future" },
                  {
                    priority: distinctPriorities ? 100 + offset + index : 100,
                    runAt: future,
                  },
                ),
            ),
          );
        },
      );
      await Promise.all(
        Array.from(
          { length: 100 },
          async () =>
            await producer.enqueue("work", { label: "routine" }, { priority: -1, runAt: overdue }),
        ),
      );
      await producer.enqueue("work", { label: "urgent" }, { priority: 5 });
      let claim: ReturnType<typeof readCommand> | undefined;
      let discovery: Document[] | undefined;
      client.on("commandStarted", (event: CommandStartedEvent) => {
        const command = readCommand(event.command);
        if (command.findAndModify === collectionName) {
          claim ??= command;
        }
        if (
          command.aggregate === collectionName &&
          command.pipeline?.[0]?.["$changeStream"] === undefined
        ) {
          discovery ??= command.pipeline;
        }
      });
      consumer.start();
      await waitFor(() => handled.length > 0, { timeout: 3000, interval: 10 });

      if (!claim || !discovery) {
        throw new Error("Scheduler did not issue claim and discovery");
      }
      // Explain the observed atomic write without applying it. The urgent Job has
      // been claimed, leaving 100 due routine Jobs beside 1,000 future urgent Jobs.
      const claimExplanation = await db.command({
        explain: {
          findAndModify: collectionName,
          query: claim.query,
          sort: claim.sort,
          update: claim.update,
          new: claim.new,
        },
        verbosity: "executionStats",
      });
      const discoveryExplanation = await db
        .collection(collectionName)
        .aggregate(discovery)
        .explain("executionStats");
      const { stats: claimStats, winningPlan } = readExplanation(claimExplanation);
      const { stats: discoveryStats } = readExplanation(discoveryExplanation);
      // Permit either ordered priority scans or deadline scans with a bounded
      // sort. Both are valid planner choices; neither needs future Job payloads.
      expect(JSON.stringify(winningPlan)).not.toContain("COLLSCAN");
      expect(claimStats.totalKeysExamined).toBeLessThanOrEqual(1101);
      expect(claimStats.totalDocsExamined).toBeLessThanOrEqual(100);

      expect(discoveryStats.totalKeysExamined).toBeLessThan(50);
      expect({
        claimWouldModify: claimStats.executionStages?.nWouldModify,
        discoveryDocuments: discoveryStats.totalDocsExamined,
        handled,
      }).toStrictEqual({ claimWouldModify: 1, discoveryDocuments: 0, handled: ["urgent"] });
      console.info("priority query evidence", {
        distinctPriorities,
        managedLegacyIndex,
        claimKeys: claimStats.totalKeysExamined,
        claimDocuments: claimStats.totalDocsExamined,
        discoveryKeys: discoveryStats.totalKeysExamined,
        discoveryDocuments: discoveryStats.totalDocsExamined,
        claimPlan: JSON.stringify(winningPlan),
      });
    },
  );
});
