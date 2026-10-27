// Copied into a temporary application; all package imports resolve from its install.
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import nodePath from "node:path";
import { promisify } from "node:util";
import { Monque } from "@monque/core";
import { createDashboardExpressRouter } from "@monque/dashboard-express";
import { createManagementExpressRouter } from "@monque/management-express";
import express from "express";
import type { IndexDescriptionInfo, ObjectId } from "mongodb";
import { BSON, MongoClient } from "mongodb";

interface VerificationJob {
  _id: ObjectId;
  priority?: number;
}
interface ListedJob {
  id: string;
  priority?: number;
}
const isRecord = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isVerificationJob = (value: unknown): value is VerificationJob =>
  isRecord(value) && "_id" in value && value._id instanceof BSON.ObjectId;
const isListedJob = (value: unknown): value is ListedJob =>
  isRecord(value) &&
  "id" in value &&
  typeof value.id === "string" &&
  (!("priority" in value) || value.priority === undefined || typeof value.priority === "number");
const isIndex = (value: unknown): value is IndexDescriptionInfo =>
  isRecord(value) &&
  "name" in value &&
  "key" in value &&
  typeof value.name === "string" &&
  isRecord(value.key);

interface VersionedPackage {
  version: string;
}
interface OpenApiDescription {
  openapi: string;
}
const isVersionedPackage = (value: unknown): value is VersionedPackage =>
  isRecord(value) && "version" in value && typeof value.version === "string";
const isOpenApiDescription = (value: unknown): value is OpenApiDescription =>
  isRecord(value) && "openapi" in value && typeof value.openapi === "string";
const isCoreEntry = (value: unknown): value is { Monque: typeof Monque } =>
  isRecord(value) && "Monque" in value && typeof value.Monque === "function";
const isManagementEntry = (
  value: unknown,
): value is { createManagementExpressRouter: typeof createManagementExpressRouter } =>
  isRecord(value) &&
  "createManagementExpressRouter" in value &&
  typeof value.createManagementExpressRouter === "function";
const isDashboardEntry = (
  value: unknown,
): value is { createDashboardExpressRouter: typeof createDashboardExpressRouter } =>
  isRecord(value) &&
  "createDashboardExpressRouter" in value &&
  typeof value.createDashboardExpressRouter === "function";

const scenario = process.env.MONQUE_VERIFY_CASE;
const current = scenario === "current";
assert.ok(
  process.env.MONQUE_VERIFY_URI !== undefined && process.env.MONQUE_VERIFY_URI.length > 0,
  "Missing MongoDB URI",
);
assert.ok(
  process.env.MONQUE_VERIFY_SCRATCH !== undefined && process.env.MONQUE_VERIFY_SCRATCH.length > 0,
  "Missing scratch directory",
);
const client = new MongoClient(process.env.MONQUE_VERIFY_URI, { directConnection: true });
const db = client.db(scenario === "minimum-management" ? "management_compatibility" : "upgrade");
const jobs = db.collection<VerificationJob>("monque_jobs");
const snapshotPath = nodePath.join(process.env.MONQUE_VERIFY_SCRATCH, "legacy.json");
const checks = [];
let monque: Monque | undefined;
let server: Server | undefined;
let resetTsed: (() => Promise<void>) | undefined;

const request = async (path: string, options: RequestInit = {}) => {
  const address = server?.address();
  assert.ok(isRecord(address) && "port" in address, "HTTP server is not listening");
  const headers = new Headers(options.headers);
  if (!headers.has("x-verification-user")) {
    headers.set("x-verification-user", "operator");
  }
  const response = await fetch(`http://127.0.0.1:${address.port}/ops${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  return response;
};

try {
  await client.connect();
  let snapshot: { jobs: VerificationJob[]; indexes: IndexDescriptionInfo[] } | undefined;
  if (current) {
    const parsed: unknown = BSON.EJSON.parse(await readFile(snapshotPath, "utf-8"));
    assert.ok(
      isRecord(parsed) &&
        "jobs" in parsed &&
        "indexes" in parsed &&
        Array.isArray(parsed.jobs) &&
        Array.isArray(parsed.indexes),
      "Invalid legacy snapshot",
    );
    const snapshotJobs: unknown[] = parsed.jobs;
    const snapshotIndexes: unknown[] = parsed.indexes;
    assert.ok(
      snapshotJobs.every(isVerificationJob) && snapshotIndexes.every(isIndex),
      "Invalid legacy jobs or indexes",
    );
    snapshot = { jobs: snapshotJobs, indexes: snapshotIndexes };
  }
  monque = new Monque(db, { recoverStaleJobs: false });
  await monque.initialize();

  if (current) {
    assert.ok(snapshot !== undefined);
    await Promise.all(
      snapshot.jobs.map(async (before) => {
        const after = await jobs.findOne({ _id: before._id });
        assert.ok(after, "Upgrade removed a Job");
        assert.equal(after.priority, 0);
        delete after.priority;
        assert.deepEqual(after, before, "Backfill changed fields besides priority");
      }),
    );
    const indexes = await jobs.indexes();
    for (const before of snapshot.indexes) {
      assert.deepEqual(
        indexes.find((index) => index.name === before.name),
        before,
        `Upgrade changed index ${before.name}`,
      );
    }
    assert.ok(
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
    await db.collection<VerificationJob>("managed_jobs").insertOne(snapshot.jobs[0]);
    await db
      .collection("managed_jobs")
      .createIndex({ name: 1, status: 1, nextRunAt: 1, claimedBy: 1 });
    const managedIndexes = await db.collection("managed_jobs").indexes();
    try {
      await managed.initialize();
      const managedJob = await db.collection<VerificationJob>("managed_jobs").findOne({});
      assert.equal(managedJob?.priority, 0);
      assert.deepEqual(await db.collection("managed_jobs").indexes(), managedIndexes);
      checks.push("Managed indexes stay unchanged while missing priorities are backfilled");
    } finally {
      await managed.stop();
    }
  }

  const job = await monque.enqueue("consumer-smoke", { source: scenario }, { priority: 7 });
  const app = express();
  app.use("/ops", (req, res, next) => {
    if (req.get("x-verification-user") !== "operator") {
      res.sendStatus(401);
      return;
    }
    next();
  });
  app.use("/ops", createManagementExpressRouter({ monque }));
  app.use("/ops/dashboard", createDashboardExpressRouter({ apiBaseUrl: "/ops" }));
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  await Promise.all(
    ["/api/v1/jobs", "/dashboard/jobs", "/openapi.json"].map(async (path) => {
      const unauthorized = await request(path, { headers: { "x-verification-user": "" } });
      assert.equal(unauthorized.status, 401);
    }),
  );
  const listing = await request("/api/v1/jobs?view=summary");
  assert.equal(listing.status, 200);
  const listingPayload: unknown = await listing.json();
  assert.ok(
    isRecord(listingPayload) && "jobs" in listingPayload && Array.isArray(listingPayload.jobs),
  );
  const listedJobs: unknown[] = listingPayload.jobs;
  assert.ok(listedJobs.every(isListedJob));
  const listed = listedJobs.find((value) => value.id === job._id.toHexString());
  assert.ok(listed !== undefined, "Installed packages could not list their own Job");
  const capabilitiesResponse = await request("/api/v1/capabilities");
  const capabilities: unknown = await capabilitiesResponse.json();
  assert.ok(isRecord(capabilities) && "actions" in capabilities && isRecord(capabilities.actions));
  if (scenario === "minimum-core") {
    assert.equal(
      "setJobPriority" in capabilities.actions ? capabilities.actions.setJobPriority : undefined,
      false,
    );
  }
  if (scenario === "minimum-management") {
    assert.notEqual(
      "setJobPriority" in capabilities.actions ? capabilities.actions.setJobPriority : undefined,
      true,
    );
  }
  if (current) {
    assert.equal(listed.priority, 7);
    assert.equal(
      "setJobPriority" in capabilities.actions ? capabilities.actions.setJobPriority : undefined,
      true,
    );
    const changed = await request(`/api/v1/jobs/${job._id.toHexString()}/actions/priority`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: -5 }),
    });
    assert.equal(changed.status, 200, await changed.text());
    const updatedJob = await monque.getJob(job._id);
    assert.equal(updatedJob?.priority, -5);
  }
  if (scenario === "minimum-core") {
    const denied = await request(`/api/v1/jobs/${job._id.toHexString()}/actions/priority`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ priority: 5 }),
    });
    assert.equal(denied.status, 403);
  }
  checks.push("Authenticated Express reads, OpenAPI, and supported priority capabilities");
  const openapi = await request("/openapi.json");
  assert.equal(openapi.status, 200);
  const openApiPayload: unknown = await openapi.json();
  assert.ok(isOpenApiDescription(openApiPayload) && openApiPayload.openapi.startsWith("3."));
  const htmlResponse = await request(`/dashboard/jobs/${job._id.toHexString()}`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.ok(html.includes('"apiBaseUrl":"/ops"'));
  const assets = [
    ...html.matchAll(/(?:src|href)="(?<asset>\/ops\/dashboard\/assets\/[^"?#]+)"/gu),
  ].map((match) => match[1]);
  assert.ok(assets.length > 0, "Packed Dashboard has no asset references");
  await Promise.all(
    assets.map(async (path) => {
      const asset = await request(path.slice(4));
      assert.equal(asset.status, 200, path);
      assert.match(asset.headers.get("cache-control") ?? "", /immutable/u);
      const content = await asset.arrayBuffer();
      assert.ok(content.byteLength > 0);
    }),
  );
  checks.push(
    "Packed Dashboard serves deep links, runtime configuration, and entry assets under a nested mount",
  );
  const require = createRequire(import.meta.url);
  const coreEntry: unknown = require("@monque/core");
  const managementEntry: unknown = require("@monque/management-express");
  const dashboardEntry: unknown = require("@monque/dashboard-express");
  assert.ok(isCoreEntry(coreEntry));
  assert.ok(isManagementEntry(managementEntry));
  assert.ok(isDashboardEntry(dashboardEntry));
  checks.push("ESM and CommonJS package entrypoints load");

  if (scenario === "minimum-core") {
    await monque.enqueue(
      "legacy-future",
      { preserved: true },
      { runAt: new Date(Date.now() + 86_400_000) },
    );
    const activeMonque = monque;
    await Promise.all(
      ["completed", "failed", "cancelled", "processing"].map(async (status) => {
        const legacy = await activeMonque.enqueue(`legacy-${status}`, { preserved: status });
        const update = { status, failCount: status === "failed" ? 2 : 0 };
        const lease =
          status === "processing"
            ? {
                claimedBy: "previous-instance",
                claimId: "previous-claim",
                lockedAt: new Date(),
                lastHeartbeat: new Date(),
              }
            : undefined;
        await jobs.updateOne(
          { _id: legacy._id },
          { $set: lease === undefined ? update : { ...update, ...lease } },
        );
      }),
    );
    await writeFile(
      snapshotPath,
      BSON.EJSON.stringify({ jobs: await jobs.find().toArray(), indexes: await jobs.indexes() }),
    );
  }
  if (current) {
    const { Configuration } = await import("@tsed/di");
    const { PlatformTest } = await import("@tsed/platform-http/testing");
    const { MonqueModule, MonqueService } = await import("@monque/tsed");
    // Ts.ED uses this empty decorated class as the server DI token.
    // oxlint-disable-next-line typescript/no-extraneous-class
    class ConsumerServer {}
    Configuration({ port: 0, disableComponentScan: true, httpsPort: false })(ConsumerServer);
    resetTsed = async () => {
      await PlatformTest.reset();
    };
    await PlatformTest.bootstrap(ConsumerServer, {
      imports: [MonqueModule],
      monque: { dbFactory: () => client.db("tsed_consumer"), disableJobProcessing: true },
    })();
    const service = PlatformTest.get<InstanceType<typeof MonqueService>>(MonqueService);
    const tsedJob = await service.now("tsed-priority", { from: "consumer" }, { priority: 12 });
    const initialTsedJob = await service.getJob(tsedJob._id);
    assert.ok(initialTsedJob !== null);
    assert.equal(initialTsedJob.priority, 12);
    await service.setJobPriority(tsedJob._id.toHexString(), -2);
    const updatedTsedJob = await service.getJob(tsedJob._id);
    assert.ok(updatedTsedJob !== null);
    assert.equal(updatedTsedJob.priority, -2);
    assert.equal(service.isHealthy(), false, "Producer-only Ts.ED instance started processing");
    checks.push(
      "Installed Ts.ED module bootstraps through DI and forwards priority intake and changes",
    );
  }
  const versions: Record<string, string> = {};
  await Promise.all(
    [
      "core",
      "management",
      "management-express",
      "dashboard",
      "dashboard-express",
      ...(current ? ["tsed"] : []),
    ].map(async (name) => {
      const manifest: unknown = JSON.parse(
        await readFile(`node_modules/@monque/${name}/package.json`, "utf-8"),
      );
      assert.ok(isVersionedPackage(manifest));
      versions[`@monque/${name}`] = manifest.version;
    }),
  );
  await writeFile("result.json", `${JSON.stringify({ scenario, versions, checks }, null, 2)}\n`);
} finally {
  const serverToClose = server;
  try {
    await Promise.all([
      resetTsed?.(),
      monque?.stop(),
      serverToClose === undefined
        ? undefined
        : promisify((onClosed: (error?: Error) => void) => {
            serverToClose.close(onClosed);
          })(),
    ]);
  } finally {
    await client.close();
  }
}
