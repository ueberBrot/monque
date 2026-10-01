import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { Monque } from "@/scheduler";
import {
  cleanupTestDb,
  getTestDb,
  stopMonqueInstances,
  uniqueCollectionName,
  waitFor,
} from "@test-utils/test-utils.js";

describe("discovery with collection collation", () => {
  let db: Db;
  const instances: Monque[] = [];

  beforeAll(async () => {
    db = await getTestDb("discovery-collation");
  });

  afterEach(async () => {
    await stopMonqueInstances(instances);
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it.each([false, true])("discovers a persisted case-variant job, future: %s", async (future) => {
    const collectionName = uniqueCollectionName("case-variant");
    await db.createCollection(collectionName, { collation: { locale: "en", strength: 2 } });
    const monque = new Monque(db, {
      collectionName,
      pollInterval: 60_000,
      safetyPollInterval: 60_000,
    });
    instances.push(monque);
    await monque.initialize();
    const handled: string[] = [];
    monque.register("email", async (job) => {
      handled.push(job.name);
    });
    await monque.enqueue("EMAIL", {}, { runAt: new Date(Date.now() + (future ? 700 : 0)) });

    monque.start();

    await waitFor(async () => handled.length === 1, { timeout: 3000, interval: 10 });
    expect(handled).toEqual(["EMAIL"]);
  });

  it("preserves shared-slot fairness for collation-equivalent registered names", async () => {
    const collectionName = uniqueCollectionName("equivalent-workers");
    await db.createCollection(collectionName, { collation: { locale: "en", strength: 2 } });
    const monque = new Monque(db, {
      collectionName,
      instanceConcurrency: 1,
      pollInterval: 60_000,
      safetyPollInterval: 60_000,
    });
    instances.push(monque);
    await monque.initialize();
    const handledBy: string[] = [];
    for (const name of ["email", "EMAIL"]) {
      monque.register(name, async () => {
        handledBy.push(name);
      });
    }
    await monque.enqueueMany(Array.from({ length: 4 }, () => ({ name: "EMAIL", data: {} })));

    monque.start();

    await waitFor(async () => handledBy.length === 4, { timeout: 3000, interval: 10 });
    expect(handledBy).toEqual(["email", "EMAIL", "email", "EMAIL"]);
  });
});
