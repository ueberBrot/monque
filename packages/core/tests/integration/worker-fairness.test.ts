import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { Monque } from "@/index";
import { cleanupTestDb, getTestDb, uniqueCollectionName, waitFor } from "@test-utils/test-utils";

describe("worker fairness", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getTestDb("worker-fairness");
  });

  afterAll(async () => {
    await cleanupTestDb(db);
  });

  it("uses a replacement registered before that worker is visited", async () => {
    const monque = new Monque(db, {
      collectionName: uniqueCollectionName("replacement"),
      instanceConcurrency: 2,
    });
    await monque.initialize();
    const handled: string[] = [];
    monque.register(
      "first",
      () => {
        monque.register(
          "second",
          () => {
            handled.push("new");
          },
          { replace: true },
        );
      },
      { concurrency: 1 },
    );
    monque.register("second", () => {
      handled.push("old");
    });
    await monque.enqueue("first", {});
    await monque.enqueue("second", {});
    monque.start();
    try {
      await waitFor(() => handled.length > 0);
      expect(handled).toStrictEqual(["new"]);
    } finally {
      await monque.stop();
    }
  });

  it.each([false, true])(
    "serves a waiting worker before refilling a busy worker (targeted notification: %s)",
    async (targeted) => {
      const monque = new Monque(db, {
        collectionName: uniqueCollectionName("fairness"),
        instanceConcurrency: 1,
        pollInterval: targeted ? 60_000 : 20,
        safetyPollInterval: targeted ? 60_000 : 20,
      });
      await monque.initialize();
      const started: string[] = [];
      const releases: (() => void)[] = [];
      monque.register("empty", () => {});
      monque.register("busy", async () => {
        started.push("busy");
        const release: PromiseWithResolvers<void> = Promise.withResolvers();
        releases.push(release.resolve);
        await release.promise;
      });
      monque.register("waiting", () => {
        started.push("waiting");
      });
      await monque.enqueue("busy", {});
      await monque.enqueue("busy", {});
      await monque.enqueue("waiting", {});
      monque.start();
      try {
        await waitFor(() => started.length === 1);
        releases[0]?.();
        if (targeted) {
          await waitFor(async () => {
            const awaitedResult1 = await monque.getQueueViewSummaries();
            return awaitedResult1.every((view) => view.worker?.activeCount === 0);
          });
          await monque.enqueue("busy", {});
        }
        await waitFor(() => started.length >= 2);
        expect(started.slice(0, 2)).toStrictEqual(["busy", "waiting"]);
      } finally {
        const stopping = monque.stop();
        for (const release of releases) {
          release();
        }
        await stopping;
      }
    },
  );
});
