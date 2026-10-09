import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { Monque } from "@monque/core";
import type { Job } from "@monque/core";
import { createDashboardExpressRouter } from "@monque/dashboard-express";
import { createManagementExpressRouter } from "@monque/management-express";
import { test as base, expect } from "@playwright/test";
import express from "express";
import type { Request } from "express";
import { MongoClient } from "mongodb";
import { z } from "zod";

import { isString } from "../../../../packages/dashboard/src/lib/type-guards.js";
import { createLocalDbManagementServer } from "../../src/local-db/management-server.js";
import {
  createJob,
  createScenario,
  registerScenarioWorkers,
} from "../../src/local-db/scenarios.js";
import type { ScenarioName } from "../../src/local-db/scenarios.js";

const sessionToken = (req: Request) =>
  req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("session="))
    ?.slice(8);
const createApp = async () => {
  const client = new MongoClient(
    process.env["MONQUE_DASHBOARD_TEST_MONGO_URI"] ??
      "mongodb://127.0.0.1:27018/?directConnection=true",
    { serverSelectionTimeoutMS: 3000 },
  );
  await client.connect();
  const db = client.db(`monque_dashboard_e2e_${randomUUID().replaceAll("-", "")}`);
  const jobs = db.collection<Job>("jobs");
  const monque = new Monque(db, {
    collectionName: "jobs",
    statsCacheTtlMs: 0,
    pollInterval: 50,
    maxRetries: 2,
    baseRetryInterval: 500,
  });
  await monque.initialize();
  registerScenarioWorkers(monque, db);
  type Role = "operator" | "viewer" | "blocked";
  interface Session {
    role: Role;
    expiresAt: number;
  }
  const sessions = new Map<string, Session>();
  const deniedPriorityJobIds = new Set<string>();
  const operator = randomUUID();
  const viewer = randomUUID();
  sessions.set(operator, { role: "operator", expiresAt: Date.now() + 60_000 });
  sessions.set(viewer, { role: "viewer", expiresAt: Date.now() + 60_000 });

  const sessionFor = (req: Request) => {
    const session = sessions.get(sessionToken(req) ?? "");
    return session && session.expiresAt > Date.now() ? session : undefined;
  };
  const app = express();
  const development = createLocalDbManagementServer({
    mongoUri:
      process.env["MONQUE_DASHBOARD_TEST_MONGO_URI"] ??
      "mongodb://127.0.0.1:27018/?directConnection=true",
    databaseName: db.databaseName,
  });
  app.use("/development/api", development.middleware);
  app.use(
    "/development/dashboard",
    createDashboardExpressRouter({
      apiBaseUrl: "/development",
      pollingIntervalMs: 1000,
    }),
  );
  // Test-only host login: the dashboard delegates authentication to its host.
  const CredentialsSchema = z.strictObject({
    username: z.enum(["operator", "viewer", "blocked"]),
    password: z.string(),
  });
  app.post("/auth/login", express.json(), (req, res) => {
    const result = CredentialsSchema.safeParse(req.body);
    if (!result.success || result.data.password !== "fixture-password") {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = randomUUID();
    sessions.set(token, { role: result.data.username, expiresAt: Date.now() + 60_000 });
    res
      .cookie("session", token, { httpOnly: true, sameSite: "strict", path: "/", maxAge: 60_000 })
      .sendStatus(204);
  });
  app.post("/auth/logout", (req, res) => {
    sessions.delete(sessionToken(req) ?? "");
    res.clearCookie("session", { path: "/" }).sendStatus(204);
  });
  for (const mount of ["/open", "/readonly"]) {
    app.use(mount, createManagementExpressRouter({ monque, readOnly: mount === "/readonly" }));
    app.use(
      `${mount}/dashboard`,
      createDashboardExpressRouter({ apiBaseUrl: mount, pollingIntervalMs: 500 }),
    );
  }
  app.use("/private", (req, res, next) => {
    if (!sessionFor(req)) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }
    next();
  });
  app.use(
    "/private",
    createManagementExpressRouter({
      monque,
      context: ({ req }) => sessionFor(req)?.role,
      authorize: ({ action, context, job }) =>
        (context === "operator" || (context === "viewer" && action === "read")) &&
        !(action === "setJobPriority" && job && deniedPriorityJobIds.has(job._id.toHexString())),
    }),
  );
  app.use(
    "/private/dashboard",
    createDashboardExpressRouter({ apiBaseUrl: "/private", pollingIntervalMs: 500 }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || isString(address)) {
    throw new Error("Missing test server address");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    client,
    db,
    jobs,
    monque,
    sessions,
    deniedPriorityJobIds,
    operator,
    viewer,
    development,
    async reset() {
      await development.close();
      await db.collection("monque_dashboard_jobs").deleteMany({});
      await db.collection("monque_dashboard_seed").deleteMany({});
      await monque.stop();
      await jobs.deleteMany({});
      await db.collection("effects").deleteMany({});
      await db.collection("attempts").deleteMany({});
      sessions.clear();
      deniedPriorityJobIds.clear();
      sessions.set(operator, { role: "operator", expiresAt: Date.now() + 60_000 });
      sessions.set(viewer, { role: "viewer", expiresAt: Date.now() + 60_000 });
    },
    async seed(overrides: Partial<Job> = {}) {
      const job = createJob(overrides);
      await jobs.insertOne(job);
      return job;
    },
    async seedScenario(name: ScenarioName) {
      const records = createScenario(name);
      await jobs.insertMany(records);
      return records;
    },
    async close() {
      await development.close();
      await monque.stop();
      server.closeAllConnections();
      const closed: PromiseWithResolvers<void> = Promise.withResolvers();
      server.close((failure) => {
        if (failure) {
          closed.reject(failure);
        } else {
          closed.resolve();
        }
      });
      await closed.promise;
      // This fixture owns this randomly named database, never the development database.
      await client.connect();
      await db.dropDatabase();
      await client.close();
    },
  };
};
type RealApp = Awaited<ReturnType<typeof createApp>>;
const test = base.extend<
  {
    app: RealApp & {
      base: string;
    };
    authenticated: boolean;
    pageErrors: undefined;
  },
  {
    server: RealApp;
  }
>({
  authenticated: [false, { option: true }],
  server: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructuring fixture dependencies.
    async ({}, provide) => {
      const server = await createApp();
      try {
        await provide(server);
      } finally {
        await server.close();
      }
    },
    { scope: "worker" },
  ],
  app: async ({ server, context, authenticated }, provide) => {
    await server.reset();
    if (authenticated) {
      const response = await context.request.post(`${server.origin}/auth/login`, {
        data: { username: "operator", password: "fixture-password" },
      });
      expect(response.status()).toBe(204);
    }
    await provide({ ...server, base: `${server.origin}/${authenticated ? "private" : "open"}` });
  },
  pageErrors: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await provide(undefined);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
export { test };
export { expect } from "@playwright/test";
