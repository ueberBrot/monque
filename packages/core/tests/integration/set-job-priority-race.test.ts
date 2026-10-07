import { MongoDBContainer, type StartedMongoDBContainer } from "@testcontainers/mongodb";
import { type Db, MongoClient } from "mongodb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { type Job, JobStateError, Monque } from "@/index";
import { stopMonqueInstances, uniqueCollectionName, waitFor } from "@test-utils/test-utils";

describe("priority edits racing with another Scheduler Instance", () => {
  let container: StartedMongoDBContainer;
  let editorClient: MongoClient;
  let claimerClient: MongoClient;
  let db: Db;
  const instances: Monque[] = [];

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

  async function blockNextWrite(appName: string): Promise<() => Promise<void>> {
    const { count } = await db.admin().command({
      configureFailPoint: "failCommand",
      mode: { times: 1 },
      data: {
        appName,
        failCommands: ["findAndModify", "update"],
        blockConnection: true,
        blockTimeMS: 5_000,
      },
    });
    return async () => {
      await db.admin().command({
        waitForFailPoint: "failCommand",
        timesEntered: count + 1,
        maxTimeMS: 2_000,
      });
    };
  }

  async function createSchedulers() {
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
  }

  it("selects the promoted Job when an edit commits during an in-flight claim", async () => {
    const { editor, claimer } = await createSchedulers();
    const routine = await editor.now("work", "routine", { priority: 1 });
    const promoted = await editor.now("work", "promoted", { priority: -1 });
    const received: Job[] = [];
    const release = Promise.withResolvers<void>();
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
      expect(received).toEqual([]);
      await waitFor(async () => received.length > 0, { timeout: 10_000, interval: 10 });
      expect(received[0]).toMatchObject({ _id: promoted._id, priority: 5, status: "processing" });
      const claimed = await editor.getJob(promoted._id);
      expect(claimed).toMatchObject({
        priority: 5,
        status: "processing",
        claimedBy: expect.any(String),
        claimId: expect.any(String),
      });
    } finally {
      release.resolve();
    }
    await waitFor(async () => (await editor.getJob(routine._id))?.status === "completed");
    expect(received.map((job) => job.data)).toEqual(["promoted", "routine"]);
    expect((await editor.getJob(promoted._id))?.priority).toBe(5);
  });

  it("rejects an in-flight edit when another instance claims before its write", async () => {
    const { editor, claimer } = await createSchedulers();
    const job = await editor.now("work", {}, { priority: 3 });
    let running: Job | undefined;
    const release = Promise.withResolvers<void>();
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
      (error: unknown) => {
        editSettled = true;
        return { error };
      },
    );
    try {
      // This server barrier is after any preliminary read but before the write:
      // checking pending first and then updating unconditionally cannot pass.
      await waitUntilBlocked();
      claimer.start();
      await waitFor(async () => running !== undefined, { timeout: 2_000, interval: 10 });
      const claimed = await editor.getJob(job._id);
      expect(editSettled).toBe(false);
      expect(claimed).toMatchObject({
        priority: 3,
        status: "processing",
        claimedBy: expect.any(String),
        claimId: expect.any(String),
      });
      expect(await edit).toEqual({ error: expect.any(JobStateError) });
      expect(await editor.getJob(job._id)).toEqual(claimed);
      expect(running).toMatchObject({ priority: 3, status: "processing" });
    } finally {
      release.resolve();
      await edit;
    }
    await waitFor(async () => (await editor.getJob(job._id))?.status === "completed");
    expect((await editor.getJob(job._id))?.priority).toBe(3);
  });
});
