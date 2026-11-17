/* oxlint-disable unicorn/no-await-expression-member -- Keep public HTTP response assertions beside their requests. */
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { connect, createServer } from "node:net";
import { CapabilitiesDtoSchema, JobDtoSchema, ProcessingStateDtoSchema } from "@monque/management";
import type { ManagementContract } from "@monque/management";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { MongoDBContainer } from "@testcontainers/mongodb";
import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import { Predicate } from "effect";
import { MongoClient } from "mongodb";
import { chromium } from "playwright";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { launchHost } from "./process.js";

const viewer = { authorization: `Basic ${Buffer.from("viewer:viewer-secret").toString("base64")}` };

const operator = {
  authorization: `Basic ${Buffer.from("operator:operator-secret").toString("base64")}`,
};

describe("actual Bun Effect host", () => {
  let container: StartedMongoDBContainer;
  let processHost: ReturnType<typeof launchHost>;
  let url: string;
  let jobId: string;
  let databaseName: string;

  const start = async (env: Record<string, string> = {}) => {
    databaseName = `host_${randomUUID().replaceAll("-", "")}`;
    processHost = launchHost({
      MONGO_URI: `${container.getConnectionString()}?directConnection=true`,
      MONGO_DATABASE: databaseName,
      ...env,
    });
    await expect
      .poll(() => processHost.output(), { timeout: 15_000 })
      .toMatch(/Dashboard: http:\/\/127.0.0.1:\d+\/custom\/ui; Job: [a-f\d]{24}/u);

    const match =
      /Dashboard: (?<url>http:\/\/127.0.0.1:\d+)\/custom\/ui; Job: (?<job>[a-f\d]{24})/u.exec(
        processHost.output(),
      );

    url = match?.groups?.["url"] ?? "";
    jobId = match?.groups?.["job"] ?? "";
  };

  const request = async (path: string, init: RequestInit = {}) =>
    await fetch(`${url}/custom/control/api/v1${path}`, { headers: operator, ...init });

  const rpc = (headers = operator): RouterContractClient<ManagementContract> =>
    createORPCClient(new RPCLink({ origin: url, url: "/custom/control/rpc", headers }));

  beforeAll(async () => {
    container = await new MongoDBContainer("mongo:8").start();
  });
  beforeEach(async () => {
    await start();
  });
  afterEach(async () => {
    await processHost?.stop();
  });

  afterAll(async () => {
    await container?.stop();
  });

  it("authenticates HTML, assets, HTTP, RPC and OpenAPI", async () => {
    await Promise.all(
      [
        "/custom/ui",
        `/custom/ui/jobs/${jobId}`,
        "/custom/ui/assets/missing.js",
        "/custom/control/api/v1/jobs",
        "/custom/control/rpc/jobs/list",
        "/custom/control/openapi.json",
      ].map(async (path) => {
        const response = await fetch(`${url}${path}`);
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain('Basic realm="Monque"');
      }),
    );
  });

  it("processes a native Job and serves custom deep links and real assets", async () => {
    await expect
      .poll(async () => JobDtoSchema.parse(await (await request(`/jobs/${jobId}`)).json()).status)
      .toBe("completed");
    const response = await fetch(`${url}/custom/ui/jobs/${jobId}`, { headers: viewer });
    const html = await response.text();
    expect(html).toContain('"apiBaseUrl":"/custom/control"');
    expect(html).toContain('"basePath":"/custom/ui"');
    const asset = /src="(?<asset>[^" ]+\.js)"/u.exec(html)?.groups?.["asset"];
    expect(asset).toMatch(/^\/custom\/ui\/assets\//u);
    expect((await fetch(`${url}${asset}`, { headers: viewer })).status).toBe(200);
    expect((await fetch(`${url}/custom/ui/assets/missing.js`, { headers: viewer })).status).toBe(
      404,
    );
  });

  it("persists the receipt produced by the captured native Worker application service", async () => {
    const client = new MongoClient(`${container.getConnectionString()}?directConnection=true`);

    try {
      await client.connect();
      await expect
        .poll(
          async () =>
            await client
              .db(databaseName)
              .collection<{ _id: string; processed: boolean }>("receipts")
              .countDocuments({ _id: jobId, processed: true }),
        )
        .toBe(1);
    } finally {
      await client.close();
    }
  });

  it("renders and reloads a viewer deep link and permits operator RPC controls in Chromium", async () => {
    const browser = await chromium.launch();

    try {
      const context = await browser.newContext({
        httpCredentials: { username: "viewer", password: "viewer-secret" },
      });

      const page = await context.newPage();
      await page.goto(`${url}/custom/ui/jobs/${jobId}`);
      await page.getByRole("heading", { name: "receipt", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "receipt", exact: true }).waitFor();
      await expect(
        page.getByRole("button", { name: "Retry", exact: true }).isDisabled(),
      ).resolves.toBe(true);
      await context.close();

      const operatorContext = await browser.newContext({
        httpCredentials: { username: "operator", password: "operator-secret" },
      });

      const operatorPage = await operatorContext.newPage();
      await operatorPage.goto(`${url}/custom/ui/health`);

      await Promise.all([
        operatorPage.waitForResponse(
          (response) =>
            response.url().endsWith("/rpc/pauseProcessing") && response.status() === 200,
        ),
        operatorPage.getByRole("button", { name: "Pause instance", exact: true }).click(),
      ]);
      await operatorPage.getByRole("button", { name: "Resume instance", exact: true }).waitFor();
      const state = await rpc().processingState();
      expect(state.paused).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("uses the host identity for HTTP and RPC capabilities and mutation policy", async () => {
    expect(
      CapabilitiesDtoSchema.parse(
        await (await request("/capabilities", { headers: viewer })).json(),
      ).actions.cancel,
    ).toBe(false);
    expect((await rpc(viewer).capabilities()).actions.cancel).toBe(false);
    expect((await rpc().capabilities()).actions.cancel).toBe(true);
    expect(
      (await request(`/jobs/${jobId}/actions/cancel`, { method: "POST", headers: viewer })).status,
    ).toBe(403);
    expect((await request(`/jobs/${jobId}`, { method: "DELETE" })).status).toBe(403);
  });

  it("denies forbidden native RPC operations with protocol errors", async () => {
    await expect(rpc(viewer).cancelJob({ params: { id: jobId } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(rpc().deleteJob({ params: { id: jobId } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows operator pause/resume through public HTTP", async () => {
    const state = await rpc().processingState();
    const body = JSON.stringify({ instanceId: state.instanceId });
    const headers = { ...operator, "content-type": "application/json" };
    expect(
      ProcessingStateDtoSchema.parse(
        await (
          await request("/processing/actions/pause", { method: "POST", headers, body })
        ).json(),
      ).paused,
    ).toBe(true);
    expect(
      ProcessingStateDtoSchema.parse(
        await (
          await request("/processing/actions/resume", { method: "POST", headers, body })
        ).json(),
      ).paused,
    ).toBe(false);
  });

  it("preserves request protections", async () => {
    const headers = { ...operator, "content-type": "application/json" };
    expect(
      (
        await request(`/jobs/${jobId}/actions/cancel`, {
          method: "POST",
          headers: { ...operator, origin: "https://untrusted.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/jobs/${jobId}/actions/priority`, {
          headers,
          method: "POST",
          body: JSON.stringify({ priority: "a".repeat(70_000) }),
        })
      ).status,
    ).toBe(413);
    expect((await request("/jobs/invalid-id")).status).toBe(400);
    expect((await request("/jobs/000000000000000000000000")).status).toBe(404);
  });

  it("denies operator mutations in read-only mode on both transports", async () => {
    await processHost.stop();
    await start({ READ_ONLY: "true" });
    await expect(rpc().capabilities()).resolves.toMatchObject({
      readOnly: true,
      actions: { cancel: false },
    });
    expect((await request(`/jobs/${jobId}/actions/cancel`, { method: "POST" })).status).toBe(403);
  });

  it("joins an unfinished authenticated request before releasing shared resources", async () => {
    const socket = connect(Number(new URL(url).port), "127.0.0.1");
    const closed = once(socket, "close");
    socket.on("error", () => {
      /* Shutdown may reset the unfinished upload. */
    });
    await once(socket, "connect");
    socket.write(
      `POST /custom/control/api/v1/jobs/${jobId}/actions/priority HTTP/1.1\r\nHost: ${new URL(url).host}\r\nAuthorization: ${operator.authorization}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`,
    );
    socket.resume();
    await expect.poll(() => processHost.output()).toContain("Request started");
    await processHost.stop();
    await closed;
    expect(processHost.output()).toMatch(
      /Request finished[\s\S]*Released HTTP[\s\S]*Released Monque[\s\S]*Released MongoDB/u,
    );
  });

  it.each(["terminal", "recovered"] as const)(
    "cleans up Monque and MongoDB after %s listener startup failure",
    async (mode) => {
      await processHost.stop();
      const occupied = createServer();
      occupied.listen(0, "127.0.0.1");
      await once(occupied, "listening");
      const address = occupied.address();

      if (address === null || Predicate.isString(address)) {
        throw new Error("Expected TCP");
      }

      try {
        processHost = launchHost(
          {
            MONGO_URI: `${container.getConnectionString()}?directConnection=true`,
            MONGO_DATABASE: `failure_${randomUUID()}`,
            PORT: String(address.port),
          },
          mode === "terminal" ? "src/main.ts" : "tests/recovered-startup.ts",
        );

        await (mode === "terminal"
          ? processHost.exited
          : vi.waitUntil(() => processHost.output().includes("Startup recovered")));

        expect(processHost.child.exitCode).toBe(mode === "terminal" ? 1 : null);
        expect(processHost.output()).toMatch(
          mode === "terminal"
            ? /Released Monque[\s\S]*Released MongoDB/u
            : /Released Monque[\s\S]*Released MongoDB[\s\S]*Startup recovered/u,
        );
        expect(processHost.output()).not.toContain("Dashboard:");
      } finally {
        occupied.close();
      }
    },
  );

  it("closes the acquired MongoDB client after connection failure", async () => {
    await processHost.stop();
    processHost = launchHost({ MONGO_URI: "mongodb://127.0.0.1:1/?directConnection=true" });
    await processHost.exited;
    expect(processHost.child.exitCode).not.toBe(0);
    expect(processHost.output()).toContain("Released MongoDB");
    expect(processHost.output()).not.toContain("Dashboard:");
  });

  it("releases application-owned telemetry after HTTP, Monque and MongoDB", async () => {
    await processHost.stop();
    await start({ MONQUE_TRACING: "true" });
    await expect
      .poll(async () => JobDtoSchema.parse(await (await request(`/jobs/${jobId}`)).json()).status)
      .toBe("completed");
    await processHost.stop();
    expect(processHost.output()).toContain("monque.worker");
    expect(processHost.output()).toMatch(
      /Released HTTP[\s\S]*Released Monque[\s\S]*Released MongoDB[\s\S]*Released telemetry/u,
    );
  });

  it("keeps a borrowed telemetry provider usable after host release", async () => {
    await processHost.stop();
    processHost = launchHost(
      {
        MONGO_URI: `${container.getConnectionString()}?directConnection=true`,
        MONGO_DATABASE: `borrowed_${randomUUID()}`,
      },
      "tests/borrowed-telemetry.ts",
    );
    await processHost.exited;
    expect(processHost.child.exitCode).toBe(0);
    expect(processHost.output()).toMatch(/Released MongoDB[\s\S]*host-still-active/u);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "releases listener and owned resources on %s",
    async (signal) => {
      await processHost.stop(signal);
      expect(processHost.output()).toMatch(
        /Released HTTP[\s\S]*Released Monque[\s\S]*Released MongoDB/u,
      );
      await expect(fetch(`${url}/custom/control/api/v1/health`)).rejects.toThrow(/fetch failed/iu);
    },
  );
});
