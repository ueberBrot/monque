// Copied into a temporary application; all package imports resolve from its install.
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Monque } from "@monque/core";
import { createDashboardExpressRouter } from "@monque/dashboard-express";
import { createManagementExpressRouter } from "@monque/management-express";
import express from "express";
import { BSON, MongoClient } from "mongodb";

const scenario = process.env.MONQUE_VERIFY_CASE;
const current = scenario === "current";
const client = new MongoClient(process.env.MONQUE_VERIFY_URI, { directConnection: true });
const db = client.db(scenario === "minimum-management" ? "management_compatibility" : "upgrade");
const jobs = db.collection("monque_jobs");
const snapshotPath = join(process.env.MONQUE_VERIFY_SCRATCH, "legacy.json");
const checks = [];
let monque;
let server;
let resetTsed;

async function request(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/ops${path}`, {
    ...options,
    headers: { "x-verification-user": "operator", ...options.headers },
    signal: AbortSignal.timeout(15_000),
  });
  return response;
}

try {
  await client.connect();
  let snapshot;
  if (current) snapshot = BSON.EJSON.parse(await readFile(snapshotPath, "utf8"));
  monque = new Monque(db, { recoverStaleJobs: false });
  await monque.initialize();

  if (current) {
    for (const before of snapshot.jobs) {
      const after = await jobs.findOne({ _id: before._id });
      assert.equal(after.priority, 0);
      delete after.priority;
      assert.deepEqual(after, before, "Backfill changed fields besides priority");
    }
    const indexes = await jobs.indexes();
    for (const before of snapshot.indexes) {
      assert.deepEqual(
        indexes.find((index) => index.name === before.name),
        before,
        `Upgrade changed index ${before.name}`,
      );
    }
    assert(
      indexes.some(
        (index) =>
          JSON.stringify(index.key) ===
          JSON.stringify({ name: 1, status: 1, priority: -1, nextRunAt: 1, _id: 1 }),
      ),
    );
    const beforeRestart = await jobs.find().toArray();
    await monque.stop();
    await monque.initialize();
    assert.deepEqual(
      await jobs.find().toArray(),
      beforeRestart,
      "Repeated initialization changed Jobs",
    );
    checks.push(
      "Legacy collection backfill preserves all other fields and indexes; repeated initialization preserves Jobs",
    );

    const managed = new Monque(db, {
      collectionName: "managed_jobs",
      skipIndexCreation: true,
      recoverStaleJobs: false,
    });
    await db.collection("managed_jobs").insertOne(snapshot.jobs[0]);
    await db
      .collection("managed_jobs")
      .createIndex({ name: 1, status: 1, nextRunAt: 1, claimedBy: 1 });
    const managedIndexes = await db.collection("managed_jobs").indexes();
    try {
      await managed.initialize();
      assert.equal((await db.collection("managed_jobs").findOne({})).priority, 0);
      assert.deepEqual(await db.collection("managed_jobs").indexes(), managedIndexes);
      checks.push("Managed indexes stay unchanged while missing priorities are backfilled");
    } finally {
      await managed.stop();
    }
  }

  const job = await monque.enqueue("consumer-smoke", { source: scenario }, { priority: 7 });
  const app = express();
  app.use("/ops", (req, res, next) => {
    if (req.get("x-verification-user") !== "operator") return res.sendStatus(401);
    next();
  });
  app.use("/ops", createManagementExpressRouter({ monque }));
  app.use("/ops/dashboard", createDashboardExpressRouter({ apiBaseUrl: "/ops" }));
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  for (const path of ["/api/v1/jobs", "/dashboard/jobs", "/openapi.json"]) {
    assert.equal((await request(path, { headers: { "x-verification-user": "" } })).status, 401);
  }
  const listing = await request("/api/v1/jobs?view=summary");
  assert.equal(listing.status, 200);
  const listed = (await listing.json()).jobs.find((value) => value.id === job._id.toHexString());
  assert(listed, "Installed packages could not list their own Job");
  const capabilities = await (await request("/api/v1/capabilities")).json();
  if (scenario === "minimum-core") assert.equal(capabilities.actions.setJobPriority, false);
  if (scenario === "minimum-management") assert.notEqual(capabilities.actions.setJobPriority, true);
  if (current) {
    assert.equal(listed.priority, 7);
    assert.equal(capabilities.actions.setJobPriority, true);
    const changed = await request(`/api/v1/jobs/${job._id}/actions/priority`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: -5 }),
    });
    assert.equal(changed.status, 200, await changed.text());
    assert.equal((await monque.getJob(job._id)).priority, -5);
  }
  if (scenario === "minimum-core") {
    const denied = await request(`/api/v1/jobs/${job._id}/actions/priority`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: 5 }),
    });
    assert.equal(denied.status, 403);
  }
  checks.push("Authenticated Express reads, OpenAPI, and supported priority capabilities");
  const openapi = await request("/openapi.json");
  assert.equal(openapi.status, 200);
  assert((await openapi.json()).openapi.startsWith("3."));
  const htmlResponse = await request(`/dashboard/jobs/${job._id}`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert(html.includes('"apiBaseUrl":"/ops"'));
  const assets = [...html.matchAll(/(?:src|href)="(\/ops\/dashboard\/assets\/[^"?#]+)"/g)].map(
    (match) => match[1],
  );
  assert(assets.length > 0, "Packed Dashboard has no asset references");
  for (const path of assets) {
    const asset = await request(path.slice(4));
    assert.equal(asset.status, 200, path);
    assert.match(asset.headers.get("cache-control"), /immutable/);
    assert((await asset.arrayBuffer()).byteLength > 0);
  }
  checks.push(
    "Packed Dashboard serves deep links, runtime configuration, and entry assets under a nested mount",
  );
  const require = createRequire(import.meta.url);
  assert.equal(typeof require("@monque/core").Monque, "function");
  assert.equal(
    typeof require("@monque/management-express").createManagementExpressRouter,
    "function",
  );
  assert.equal(
    typeof require("@monque/dashboard-express").createDashboardExpressRouter,
    "function",
  );
  checks.push("ESM and CommonJS package entrypoints load");

  if (scenario === "minimum-core") {
    await monque.enqueue(
      "legacy-future",
      { preserved: true },
      { runAt: new Date(Date.now() + 86_400_000) },
    );
    for (const status of ["completed", "failed", "cancelled", "processing"]) {
      const legacy = await monque.enqueue(`legacy-${status}`, { preserved: status });
      await jobs.updateOne(
        { _id: legacy._id },
        {
          $set: {
            status,
            failCount: status === "failed" ? 2 : 0,
            ...(status === "processing"
              ? {
                  claimedBy: "previous-instance",
                  claimId: "previous-claim",
                  lockedAt: new Date(),
                  lastHeartbeat: new Date(),
                }
              : {}),
          },
        },
      );
    }
    await writeFile(
      snapshotPath,
      BSON.EJSON.stringify({ jobs: await jobs.find().toArray(), indexes: await jobs.indexes() }),
    );
  }
  if (current) {
    const { Configuration } = await import("@tsed/di");
    const { PlatformTest } = await import("@tsed/platform-http/testing");
    const { MonqueModule, MonqueService } = await import("@monque/tsed");
    class ConsumerServer {}
    Configuration({ port: 0, disableComponentScan: true, httpsPort: false })(ConsumerServer);
    resetTsed = () => PlatformTest.reset();
    await PlatformTest.bootstrap(ConsumerServer, {
      imports: [MonqueModule],
      monque: { dbFactory: () => client.db("tsed_consumer"), disableJobProcessing: true },
    })();
    const service = PlatformTest.get(MonqueService);
    const tsedJob = await service.now("tsed-priority", { from: "consumer" }, { priority: 12 });
    assert.equal((await service.getJob(tsedJob._id)).priority, 12);
    await service.setJobPriority(tsedJob._id.toHexString(), -2);
    assert.equal((await service.getJob(tsedJob._id)).priority, -2);
    assert.equal(service.isHealthy(), false, "Producer-only Ts.ED instance started processing");
    checks.push(
      "Installed Ts.ED module bootstraps through DI and forwards priority intake and changes",
    );
  }
  const versions = {};
  for (const name of [
    "core",
    "management",
    "management-express",
    "dashboard",
    "dashboard-express",
    ...(current ? ["tsed"] : []),
  ]) {
    versions[`@monque/${name}`] = JSON.parse(
      await readFile(`node_modules/@monque/${name}/package.json`, "utf8"),
    ).version;
  }
  await writeFile("result.json", `${JSON.stringify({ scenario, versions, checks }, null, 2)}\n`);
} finally {
  try {
    await Promise.all([
      resetTsed?.(),
      monque?.stop(),
      server &&
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ]);
  } finally {
    await client.close();
  }
}
