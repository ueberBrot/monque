import { MongoDBContainer } from "@testcontainers/mongodb";
import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { JobStateError, Monque } from "@/index";
import type { Job } from "@/index";
import { stopMonqueInstances, uniqueCollectionName, waitFor } from "@test-utils/test-utils";

describe("priority edits racing with another Scheduler Instance", () => {
  let db: Db;
  const blockNextWrite = async (appName: string): Promise<() => Promise<void>> => {
    const response = await db.admin().command({
      configureFailPoint: "failCommand",
      mode: { times: 1 },
      data: {
        appName,
        failCommands: ["findAndModify", "update"],
        blockConnection: true,
        blockTimeMS: 5000,
      },
    });
    const { count } = z.object({ count: z.number() }).parse(response);
    return async () => {
      await db.admin().command({
        waitForFailPoint: "failCommand",
        timesEntered: count + 1,
        maxTimeMS: 2000,
      });
    };
  };
  let claimerClient: MongoClient;
  const instances: Monque[] = [];
  const createSchedulers = async () => {
    const collectionName = uniqueCollectionName("priority-race");
    const editor = new Monque(db, { collectionName });
    const claimer = new Monque(claimerClient.db(db.databaseName), {
      collectionName,
      workerConcurrency: 1,
      heartbeatInterval: 60_000,
    });
    instances.push(editor, claimer);
    await editor.initialize();
    await claimer.initialize();
    return { editor, claimer };
  };
  let container: StartedMongoDBContainer;
  let editorClient: MongoClient;
  beforeAll(async () => {
    // Isolate server failpoints from every other integration test. MongoDBContainer
    // supplies the replica-set arguments; the entrypoint enables test commands.
    container = await new MongoDBContainer("mongo:8")
      .withEntrypoint(["docker-entrypoint.sh", "mongod", "--setParameter", "enableTestCommands=1"])
      .start();
    editorClient = new MongoClient(container.getConnectionString(), {
      directConnection: true,
      appName: "priority-editor",
    });
    claimerClient = new MongoClient(container.getConnectionString(), {
      directConnection: true,
      appName: "priority-claimer",
    });
    await Promise.all([editorClient.connect(), claimerClient.connect()]);
    db = editorClient.db("priority_race");
  });
  afterEach(async () => {
    await db.admin().command({ configureFailPoint: "failCommand", mode: "off" });
    await stopMonqueInstances(instances);
  });

  afterAll(async () => {
    try {
      await Promise.all([editorClient?.close(), claimerClient?.close()]);
    } finally {
      await container?.stop();
    }
  });

  it("selects the promoted Job when an edit commits during an in-flight claim", async () => {
    const { editor, claimer } = await createSchedulers();
    const routine = await editor.now("work", "routine", { priority: 1 });
    const promoted = await editor.now("work", "promoted", { priority: -1 });
    const received: Job[] = [];
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    claimer.register("work", async (job) => {
      received.push(job);
      await release.promise;
    });
    const waitUntilBlocked = await blockNextWrite("priority-claimer");
    claimer.start();
    try {
      await waitUntilBlocked();
      const updated = await editor.setJobPriority(promoted._id.toHexString(), 5);
      expect(updated).toMatchObject({ status: "pending", priority: 5 });
      expect(received).toStrictEqual([]);
      await waitFor(() => received.length > 0, { timeout: 10_000, interval: 10 });
      expect(received[0]).toMatchObject({ _id: promoted._id, priority: 5, status: "processing" });
      const claimed = await editor.getJob(promoted._id);
      expect(claimed).toMatchObject({
        priority: 5,
        status: "processing",
        claimedBy: claimed?.claimedBy,
        claimId: claimed?.claimId,
      });
    } finally {
      release.resolve();
    }
    await waitFor(async () => {
      const awaitedResult1 = await editor.getJob(routine._id);
      return awaitedResult1?.status === "completed";
    });
    expect(received.map((job) => job.data)).toStrictEqual(["promoted", "routine"]);
    const awaitedResult2 = await editor.getJob(promoted._id);
    expect(awaitedResult2?.priority).toBe(5);
  });

  it("rejects an in-flight edit when another instance claims before its write", async () => {
    const { editor, claimer } = await createSchedulers();
    const job = await editor.now("work", {}, { priority: 3 });
    let running: Job | undefined;
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    claimer.register("work", async (current) => {
      running = current;
      await release.promise;
    });
    const waitUntilBlocked = await blockNextWrite("priority-editor");
    let editSettled = false;
    const edit = editor.setJobPriority(job._id.toHexString(), -9).then(
      (value) => {
        editSettled = true;
        return { value };
      },
      // oxlint-disable-next-line promise/prefer-await-to-callbacks, anti-slop/no-unknown-parameters -- Record settlement immediately and narrow the native Promise rejection while the server failpoint holds the edit.
      (error: unknown) => {
        if (!(error instanceof Error)) {
          throw error;
        }
        editSettled = true;
        return { error };
      },
    );
    try {
      // This server barrier is after any preliminary read but before the write:
      // checking pending first and then updating unconditionally cannot pass.
      await waitUntilBlocked();
      claimer.start();
      await waitFor(() => running !== undefined, { timeout: 2000, interval: 10 });
      const claimed = await editor.getJob(job._id);
      expect(editSettled).toBe(false);
      expect(claimed).toMatchObject({
        priority: 3,
        status: "processing",
        claimedBy: claimed?.claimedBy,
        claimId: claimed?.claimId,
      });
      const outcome = await edit;
      if (!("error" in outcome)) {
        throw new Error("Expected a rejected priority edit");
      }
      expect(outcome.error).toBeInstanceOf(JobStateError);
      await expect(editor.getJob(job._id)).resolves.toStrictEqual(claimed);
      expect(running).toMatchObject({ priority: 3, status: "processing" });
    } finally {
      release.resolve();
      await edit;
    }
    await waitFor(async () => {
      const awaitedResult3 = await editor.getJob(job._id);
      return awaitedResult3?.status === "completed";
    });
    const awaitedResult4 = await editor.getJob(job._id);
    expect(awaitedResult4?.priority).toBe(3);
  });
});
