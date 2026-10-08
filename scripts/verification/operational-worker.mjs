import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";

import { Monque } from "../../packages/core/dist/index.mjs";

const require = createRequire(new URL("../../packages/core/package.json", import.meta.url));
const { MongoClient, BSON } = require("mongodb");
const { uri, workerId, jobMs } = JSON.parse(process.argv[2]);
const send = (message) =>
  process.connected && process.send({ ...message, workerId, at: Date.now() });
const client = new MongoClient(uri, {
  directConnection: true,
  serverSelectionTimeoutMS: 700,
  socketTimeoutMS: 700,
  heartbeatFrequencyMS: 500,
  monitorCommands: true,
});
const commands = {};
let capturedClaim = false;
client.on("commandStarted", ({ command }) => {
  if (capturedClaim || !command.findAndModify || command.query?.status !== "pending") return;
  capturedClaim = true;
  send({ type: "claim", command: BSON.EJSON.stringify(command) });
});
for (const event of ["commandSucceeded", "commandFailed"]) {
  client.on(event, ({ commandName, duration, failure }) => {
    const entry = (commands[commandName] ??= { succeeded: 0, failed: 0, totalMs: 0 });
    entry[event === "commandSucceeded" ? "succeeded" : "failed"]++;
    entry.totalMs += duration;
    if (event === "commandFailed")
      send({ type: "commandFailure", commandName, error: failure?.message });
  });
}

await client.connect();
const monque = new Monque(client.db("operational"), {
  pollInterval: 100,
  heartbeatInterval: 200,
  leaseDuration: 3_000,
  workerConcurrency: 2,
  instanceConcurrency: 3,
  baseRetryInterval: 100,
  maxRetries: 3,
  shutdownTimeout: 2_000,
  schedulerInstanceId: `operational-${workerId}`,
});
for (const name of ["work", "recurring", "crash"]) {
  monque.register(name, async (job) => {
    if (name === "crash" && workerId === 0) await new Promise(() => {});
    await sleep(jobMs);
    if (job.data.retry && job.failCount === 0) throw new Error("Deliberate first-attempt failure");
  });
}
const details = (job) => ({
  id: String(job._id),
  name: job.name,
  priority: job.priority,
  failCount: job.failCount,
  dueAt: job.nextRunAt.getTime(),
});
monque.on("job:start", (job) => send({ type: "start", ...details(job) }));
monque.on("job:complete", ({ job }) => send({ type: "complete", ...details(job) }));
monque.on("job:fail", ({ job, willRetry }) => send({ type: "fail", ...details(job), willRetry }));
monque.on("job:error", ({ error }) => send({ type: "error", error: error.message }));
monque.on("stale:recovered", ({ count }) => send({ type: "recovered", count }));
monque.on("changestream:fallback", ({ reason }) => send({ type: "fallback", reason }));
await monque.initialize();
monque.start();
send({ type: "ready" });
const sample = () => send({ type: "sample", rss: process.memoryUsage().rss, commands });
const timer = setInterval(sample, 250);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await monque.stop();
  sample();
  await client.close();
  if (process.connected) process.disconnect();
}
process.on("message", (message) => {
  if (message === "stop")
    void stop().catch((error) => {
      console.error(error);
      process.exit(1);
    });
});
process.on("SIGTERM", () => void stop());
process.on("disconnect", () => void stop());
