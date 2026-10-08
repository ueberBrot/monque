import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";

const { values } = parseArgs({
  options: {
    jobs: { type: "string", default: "240" },
    workers: { type: "string", default: "3" },
    "duration-ms": { type: "string", default: "15000" },
    "job-ms": { type: "string", default: "80" },
    "future-jobs": { type: "string", default: "1000" },
    "outage-ms": { type: "string", default: "1800" },
    "timeout-ms": { type: "string", default: "120000" },
    output: { type: "string" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "Usage: node scripts/verification/operational.mjs [--jobs 240] [--workers 3] [--duration-ms 15000] [--job-ms 80] [--future-jobs 1000] [--outage-ms 1800] [--timeout-ms 120000] [--output result.json]",
  );
  process.exit(0);
}
if (values.output) await rm(values.output, { force: true });
const settings = Object.fromEntries(
  Object.entries(values)
    .filter(([key]) => key !== "output")
    .map(([key, value]) => [key, Number(value)]),
);
for (const [key, value] of Object.entries(settings))
  assert(Number.isSafeInteger(value) && value > 0, `${key} must be a positive integer`);
assert(settings.workers >= 2, "Use at least two workers so one survives termination");
assert(settings.jobs >= 20, "Use at least 20 jobs to exercise retries and all priorities");
assert(settings["duration-ms"] >= 5_000, "Use at least 5000ms to observe recurring work");
assert(settings["outage-ms"] >= 1_000, "Use at least 1000ms to exceed driver timeouts");
assert(settings["timeout-ms"] <= 2_147_483_647, "timeout-ms exceeds Node.js timer range");
const require = createRequire(new URL("../../packages/core/package.json", import.meta.url));
const { MongoClient, BSON } = require("mongodb");
const { Monque } = await import("../../packages/core/dist/index.mjs");

const run = promisify(execFile);
const docker = async (...args) =>
  (await run("docker", args, { timeout: 30_000, maxBuffer: 1_000_000 })).stdout.trim();
const container = `monque-operational-${randomUUID()}`;
const children = [];
const events = [];
const samples = [];
const latestCommands = new Map();
let client;
let producer;
let paused = false;
let stoppingWorkers = false;
let expectedKilledWorker;
const deadline = Date.now() + settings["timeout-ms"];
const stopSignal = new AbortController();
const budgetTimer = setTimeout(
  () => stopSignal.abort(new Error("Operational workload exceeded --timeout-ms")),
  settings["timeout-ms"],
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => stopSignal.abort(new Error(`Received ${signal}`)));
const checkDeadline = () => {
  stopSignal.signal.throwIfAborted();
  assert(Date.now() < deadline, "Operational workload exceeded --timeout-ms");
};
async function waitFor(predicate, description) {
  while (!(await predicate())) {
    checkDeadline();
    await sleep(50, undefined, { signal: stopSignal.signal });
  }
  console.error(description);
}
function startWorker(workerId, uri) {
  const child = fork(
    new URL("./operational-worker.mjs", import.meta.url),
    [JSON.stringify({ uri, workerId, jobMs: settings["job-ms"] })],
    { stdio: ["ignore", "ignore", "inherit", "ipc"] },
  );
  children.push(child);
  child.on("message", (message) => {
    if (message.type === "sample") {
      samples.push({ workerId, at: message.at, rss: message.rss });
      latestCommands.set(workerId, message.commands);
    } else events.push(message);
  });
  child.on("error", (error) => stopSignal.abort(error));
  child.on("exit", (code, signal) => {
    if (!stoppingWorkers && !(workerId === expectedKilledWorker && signal === "SIGKILL"))
      stopSignal.abort(new Error(`Worker ${workerId} exited unexpectedly (${code ?? signal})`));
  });
  return child;
}
const percentile = (numbers, fraction) => {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};
async function removeContainer() {
  try {
    await docker("rm", "--force", "--volumes", container);
  } catch (error) {
    if (error.stderr?.trim() !== `Error response from daemon: No such container: ${container}`)
      throw error;
  }
}
let result;
try {
  await docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--publish",
    "127.0.0.1::27017",
    "mongo:8.0.9",
    "--bind_ip_all",
  );
  const port = (await docker("port", container, "27017/tcp")).split(":").at(-1);
  const uri = `mongodb://127.0.0.1:${port}/?directConnection=true`;
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 1_000, socketTimeoutMS: 2_000 });
  await waitFor(async () => {
    try {
      await client.connect();
      return true;
    } catch {
      return false;
    }
  }, "MongoDB ready");
  const db = client.db("operational");
  const server = await db.command({ buildInfo: 1 });
  producer = new Monque(db);
  await producer.initialize();
  const futureAt = new Date(Date.now() + settings["timeout-ms"] + 3_600_000);
  await producer.enqueueMany(
    Array.from({ length: settings["future-jobs"] }, (_, index) => ({
      name: "work",
      data: { future: index },
      priority: 100,
      runAt: futureAt,
    })),
  );
  const crashedJob = await producer.enqueue("crash", {}, { priority: 10 });
  const victim = startWorker(0, uri);
  await waitFor(
    () => events.some((event) => event.type === "start" && event.name === "crash"),
    "Victim holds a renewable claim",
  );
  for (let index = 1; index < settings.workers; index++) startWorker(index, uri);
  await waitFor(
    () => events.filter((event) => event.type === "ready").length === settings.workers,
    "All worker processes ready",
  );
  const startedAt = Date.now();
  const workload = (index) => ({
    name: "work",
    data: { index, retry: index % 10 === 0 },
    priority: [-10, 0, 10][index % 3],
  });
  const initial = Math.ceil(settings.jobs / 2);
  await producer.enqueueMany(Array.from({ length: initial }, (_, index) => workload(index)));
  await producer.schedule("*/1 * * * * *", "recurring", {}, { priority: 5, timezone: "UTC" });
  await waitFor(
    () => events.some((event) => event.type === "start" && event.name === "work"),
    "Mixed-priority backlog processing",
  );
  const killedAt = Date.now();
  expectedKilledWorker = 0;
  victim.kill("SIGKILL");
  await docker("pause", container);
  paused = true;
  const pausedAt = Date.now();
  await sleep(settings["outage-ms"], undefined, { signal: stopSignal.signal });
  await docker("unpause", container);
  paused = false;
  const resumedAt = Date.now();
  await waitFor(async () => {
    try {
      await db.command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }, "MongoDB responds after interruption");

  const captured = events.find((event) => event.type === "claim" && event.workerId !== 0);
  assert(captured, "Expected an observed priority claim command");
  const command = BSON.EJSON.parse(captured.command);
  const explain = await db.command({
    explain: {
      findAndModify: command.findAndModify,
      query: command.query,
      sort: command.sort,
      update: command.update,
      new: command.new,
    },
    verbosity: "executionStats",
  });
  let submitted = initial;
  while (submitted < settings.jobs) {
    checkDeadline();
    const target =
      initial +
      Math.ceil(
        (settings.jobs - initial) * Math.min(1, (Date.now() - startedAt) / settings["duration-ms"]),
      );
    const count = Math.min(settings.jobs, target) - submitted;
    if (count > 0) {
      await producer.enqueueMany(
        Array.from({ length: count }, (_, index) => workload(submitted + index)),
      );
      submitted += count;
    }
    await sleep(100, undefined, { signal: stopSignal.signal });
  }
  await waitFor(
    async () =>
      (await db.collection("monque_jobs").countDocuments({
        name: "work",
        "data.future": { $exists: false },
        status: "completed",
      })) === settings.jobs &&
      (await producer.getJob(crashedJob._id))?.status === "completed" &&
      events.filter((event) => event.type === "complete" && event.name === "recurring").length >= 2,
    "All finite jobs completed; recurring work repeated; killed claim recovered",
  );
  const finishedAt = Date.now();
  stoppingWorkers = true;
  for (const child of children) if (child.connected) child.send("stop");
  await waitFor(
    () => children.every((child) => child.exitCode !== null || child.signalCode !== null),
    "Worker processes stopped",
  );
  assert(
    children.slice(1).every((child) => child.exitCode === 0 && child.signalCode === null),
    "Every surviving worker must exit successfully after graceful shutdown",
  );
  const jobs = db.collection("monque_jobs");
  assert.equal(
    await jobs.countDocuments({ "data.future": { $exists: true }, status: "pending" }),
    settings["future-jobs"],
    "Future jobs must remain pending",
  );
  const persistedRetriedJobs = await jobs.countDocuments({
    name: "work",
    "data.retry": true,
    failCount: { $gte: 1 },
    status: "completed",
  });
  assert.equal(
    persistedRetriedJobs,
    Math.ceil(settings.jobs / 10),
    "Every deliberate failure must retry successfully",
  );
  const starts = events.filter((event) => event.type === "start");
  const completes = events.filter((event) => event.type === "complete");
  const resumedCompletion = completes.find((event) => event.at >= resumedAt);
  const recoveredCrash = completes.find((event) => event.id === String(crashedJob._id));
  const outageFailures = events.filter(
    (event) => event.type === "commandFailure" && event.at >= pausedAt && event.at <= resumedAt,
  );
  assert(
    outageFailures.length > 0,
    "Database interruption must produce an observed driver command failure during the pause",
  );
  assert(recoveredCrash && resumedCompletion, "Expected recovery after both faults");
  const latency = Object.fromEntries(
    [-10, 0, 10].map((priority) => {
      const delays = starts
        .filter((event) => event.name === "work" && event.priority === priority)
        .map((event) => Math.max(0, event.at - event.dueAt));
      return [
        priority,
        {
          attempts: delays.length,
          p50Ms: percentile(delays, 0.5),
          p95Ms: percentile(delays, 0.95),
          maxMs: percentile(delays, 1),
        },
      ];
    }),
  );
  result = {
    status: "passed",
    timestamp: new Date().toISOString(),
    node: process.version,
    mongodb: server.version,
    sourceCommit: (await run("git", ["rev-parse", "HEAD"])).stdout.trim(),
    host: { platform: platform(), architecture: arch() },
    coreVersion: require("./package.json").version,
    settings,
    finiteJobsCompleted: settings.jobs,
    elapsedMs: finishedAt - startedAt,
    throughputJobsPerSecond: settings.jobs / ((finishedAt - startedAt) / 1000),
    pickupLatencyByPriority: latency,
    recurringCompletions: completes.filter((event) => event.name === "recurring").length,
    persistedRetriedJobs,
    observedRetryFailureEvents: events.filter((event) => event.type === "fail" && event.willRetry)
      .length,
    faultRecovery: {
      interruptionMs: resumedAt - pausedAt,
      commandFailuresDuringPause: outageFailures.length,
      firstCompletionAfterResumeMs: resumedCompletion.at - resumedAt,
      killedJobCompletionMs: recoveredCrash.at - killedAt,
    },
    workerPeakRssBytes: Object.fromEntries(
      Array.from({ length: settings.workers }, (_, id) => [
        id,
        Math.max(
          0,
          ...samples.filter((sample) => sample.workerId === id).map((sample) => sample.rss),
        ),
      ]),
    ),
    workerCommands: Object.fromEntries(latestCommands),
    observedClaimExplain: {
      nReturned: explain.executionStats?.nReturned,
      totalKeysExamined: explain.executionStats?.totalKeysExamined,
      totalDocsExamined: explain.executionStats?.totalDocsExamined,
      executionTimeMillis: explain.executionStats?.executionTimeMillis,
      plan: explain.queryPlanner?.winningPlan,
    },
    schedulerErrors: events.filter((event) => event.type === "error"),
    commandFailures: events.filter((event) => event.type === "commandFailure"),
  };
} finally {
  clearTimeout(budgetTimer);
  stoppingWorkers = true;
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (paused) await docker("unpause", container).catch((error) => console.error(error.message));
  await producer?.stop().catch((error) => console.error(error.message));
  await client?.close();
  await removeContainer();
}
if (values.output) await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
