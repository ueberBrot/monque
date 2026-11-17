import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import type { Job } from "@monque/core";
import type { APIRequestContext } from "@playwright/test";
import { test as base, expect, request } from "@playwright/test";
import { MongoClient } from "mongodb";

import { createJob } from "../../src/local-db/scenarios.js";

const credentials = { username: "operator", password: "operator-secret" };

const start = async (adapter: "express" | "effect", readOnly: boolean, hookFailure: boolean) => {
  const databaseName = `monque_hosts_${randomUUID().replaceAll("-", "")}`;

  const mongoUri =
    process.env["MONQUE_DASHBOARD_TEST_MONGO_URI"] ??
    "mongodb://127.0.0.1:27018/?directConnection=true";

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });

  try {
    await client.connect();
  } catch (error) {
    await client.close();
    throw error;
  }

  const db = client.db(databaseName);

  const effectEntry = hookFailure
    ? "../../examples/effect-host/tests/authorization-failure.ts"
    : "../../examples/effect-host/src/main.ts";

  const child = spawn(
    // oxlint-disable-next-line sonarjs/no-os-command-from-path -- Use the workspace-pinned Bun.
    "bun",
    [adapter === "effect" ? effectEntry : "tests/hosts/express.ts"],
    {
      cwd: new URL("../..", import.meta.url),
      env: {
        ...process.env,
        MONGO_URI: mongoUri,
        MONGO_DATABASE: databaseName,
        PORT: "0",
        MANAGEMENT_PATH: "/control",
        DASHBOARD_PATH: "/ui",
        OPERATOR_PASSWORD: credentials.password,
        VIEWER_PASSWORD: "viewer-secret",
        READ_ONLY: String(readOnly),
        AUTHORIZATION_FAILURE: String(hookFailure),
        MONQUE_TRACING: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  let spawnFailure: unknown;

  // oxlint-disable-next-line promise/prefer-await-to-callbacks, anti-slop/no-unknown-parameters -- Capture arbitrary process rejection immediately while readiness consumes output.
  const exited = once(child, "close").catch((error: unknown) => {
    spawnFailure = error;
  });

  let api: APIRequestContext | undefined;

  let closing: Promise<void> | undefined;

  const stop = async () => {
    closing ??= release();
    await closing;
  };

  const release = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }

    const deadline = globalThis.setTimeout(() => {
      child.kill("SIGKILL");
    }, 10_000);

    try {
      await exited;
    } finally {
      globalThis.clearTimeout(deadline);

      try {
        await api?.dispose();
      } finally {
        try {
          await db.dropDatabase();
        } finally {
          await client.close();
        }
      }
    }
  };

  try {
    let url: string | undefined;
    const deadline = Date.now() + 20_000;

    while (url === undefined && Date.now() < deadline) {
      if (spawnFailure !== undefined || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Host exited: ${String(spawnFailure)} ${output}`);
      }

      url = /Dashboard: (?<url>http:\/\/127.0.0.1:\d+)\/ui; Job:/u.exec(output)?.groups?.["url"];

      if (url === undefined) {
        // oxlint-disable-next-line no-await-in-loop -- Poll actual process readiness sequentially.
        await setTimeout(50);
      }
    }

    if (url === undefined) {
      throw new Error(`Host readiness timeout: ${output}`);
    }

    api = await request.newContext({ httpCredentials: credentials });
    const response = await api.get(`${url}/control/api/v1/capabilities`);
    expect(response.status(), output).toBe(hookFailure ? 500 : 200);

    return {
      url,
      request: api,
      seed: async (overrides: Partial<Job> = {}) => {
        const job = createJob(overrides);
        await db.collection<Job>("monque_jobs").insertOne(job);

        return job;
      },
      close: stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
};

type App = Awaited<ReturnType<typeof start>>;

export const test = base.extend<{
  app: App;
  readOnly: boolean;
  hookFailure: boolean;
  adapter: "express" | "effect";
}>({
  adapter: ["express", { option: true }],
  readOnly: [false, { option: true }],
  hookFailure: [false, { option: true }],
  httpCredentials: credentials,
  app: async ({ readOnly, hookFailure, adapter }, provide) => {
    const app = await start(adapter, readOnly, hookFailure);

    try {
      await provide(app);
    } finally {
      await app.close();
    }
  },
});

export { expect } from "@playwright/test";
