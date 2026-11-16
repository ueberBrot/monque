import { randomUUID } from "node:crypto";
import type { MonqueInstrumentation } from "@monque/core";
import { openTelemetry } from "@monque/core/opentelemetry";
import { CapabilitiesDtoSchema, JobDtoSchema, ProcessingStateDtoSchema } from "@monque/management";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { MongoDBContainer } from "@testcontainers/mongodb";
import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import { Effect, Exit, Scope } from "effect";
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

import { host } from "../src/host.js";

const viewer = { authorization: `Basic ${Buffer.from("viewer:viewer-secret").toString("base64")}` };

const operator = {
  authorization: `Basic ${Buffer.from("operator:operator-secret").toString("base64")}`,
};

describe("Effect host", () => {
  let container: StartedMongoDBContainer;
  let scope: Scope.Closeable;
  let app: Effect.Success<ReturnType<typeof host>>;

  const acquire = async (readOnly = false, instrumentation?: MonqueInstrumentation) => {
    const options = {
      mongoUri: `${container.getConnectionString()}?directConnection=true`,
      databaseName: `host_${randomUUID().replaceAll("-", "")}`,
      operatorPassword: "operator-secret",
      viewerPassword: "viewer-secret",
      managementPath: "/custom/control",
      dashboardPath: "/custom/ui",
      port: 0,
      readOnly,
    };

    return await Effect.runPromise(
      host(instrumentation ? { ...options, instrumentation } : options).pipe(
        Effect.provideService(Scope.Scope, scope),
      ),
    );
  };

  const request = async (path: string, init: RequestInit = {}) =>
    await fetch(`${app.url}/custom/control/api/v1${path}`, { headers: operator, ...init });

  beforeAll(async () => {
    container = await new MongoDBContainer("mongo:8").start();
  });
  beforeEach(async () => {
    scope = Scope.makeUnsafe();
    app = await acquire();
  });
  afterEach(async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await container?.stop();
  });

  it("requires host authentication on Management, Dashboard, assets and OpenAPI", async () => {
    const statuses = await Promise.all(
      [
        "/custom/control/api/v1/jobs",
        "/custom/control/openapi.json",
        `/custom/ui/jobs/${app.jobId}`,
        "/custom/ui/assets/missing.js",
      ].map(async (path) => {
        const response = await fetch(`${app.url}${path}`);

        return response.status;
      }),
    );

    expect(statuses).toStrictEqual([401, 401, 401, 401]);
  });

  it("serves the existing Dashboard build at custom deep links", async () => {
    const response = await fetch(`${app.url}/custom/ui/jobs/${app.jobId}`, { headers: viewer });
    const html = await response.text();
    expect(html).toContain('"apiBaseUrl":"/custom/control"');
    expect(html).toContain('"basePath":"/custom/ui"');
    const assetPath = /src="(?<asset>[^" ]+\.js)"/u.exec(html)?.groups?.["asset"];
    expect(assetPath).toMatch(/^\/custom\/ui\/assets\//u);
    const asset = await fetch(`${app.url}${assetPath}`, { headers: viewer });
    expect(asset.status).toBe(200);
    const missing = await fetch(`${app.url}/custom/ui/assets/missing.js`, { headers: viewer });
    expect(missing.status).toBe(404);
  });

  it("renders the authenticated Dashboard from a Job deep link in Chromium", async () => {
    const browser = await chromium.launch();

    try {
      const context = await browser.newContext({
        httpCredentials: { username: "viewer", password: "viewer-secret" },
      });

      const page = await context.newPage();
      await page.goto(`${app.url}/custom/ui/jobs/${app.jobId}`);
      const heading = page.getByRole("heading", { name: "receipt", exact: true });
      await heading.waitFor({ state: "visible" });
      await expect(heading.textContent()).resolves.toBe("receipt");
      await expect(page.getByText(app.jobId, { exact: true }).isVisible()).resolves.toBe(true);
      await page.reload();
      await heading.waitFor({ state: "visible" });
      await expect(page.getByText(app.jobId, { exact: true }).isVisible()).resolves.toBe(true);
    } finally {
      await browser.close();
    }
  });

  it("reports role capabilities and denies viewer mutations and operator deletion", async () => {
    const capabilities = await request("/capabilities", { headers: viewer });
    expect(CapabilitiesDtoSchema.parse(await capabilities.json()).actions.cancel).toBe(false);

    const denied = await request(`/jobs/${app.jobId}/actions/cancel`, {
      method: "POST",
      headers: viewer,
    });

    expect(denied.status).toBe(403);
    const deletion = await request(`/jobs/${app.jobId}`, { method: "DELETE" });
    expect(deletion.status).toBe(403);
    const allowedCapabilities = await request("/capabilities");
    expect(CapabilitiesDtoSchema.parse(await allowedCapabilities.json()).actions.cancel).toBe(true);
  });

  it("allows an operator to pause and resume through the existing Route Map", async () => {
    const body = JSON.stringify({ instanceId: app.monque.getProcessingState().instanceId });
    const headers = { ...operator, "content-type": "application/json" };
    const paused = await request("/processing/actions/pause", { method: "POST", headers, body });
    expect(ProcessingStateDtoSchema.parse(await paused.json()).paused).toBe(true);
    const resumed = await request("/processing/actions/resume", { method: "POST", headers, body });
    expect(ProcessingStateDtoSchema.parse(await resumed.json()).paused).toBe(false);
  });

  it("retains origin, request size, validation and not-found protections", async () => {
    const crossOrigin = await request(`/jobs/${app.jobId}/actions/cancel`, {
      method: "POST",
      headers: { ...operator, origin: "https://untrusted.example" },
    });

    expect(crossOrigin.status).toBe(403);

    const oversized = await request(`/jobs/${app.jobId}/actions/priority`, {
      method: "POST",
      headers: { ...operator, "content-type": "application/json" },
      body: JSON.stringify({ priority: "a".repeat(70_000) }),
    });

    expect(oversized.status).toBe(413);
    const invalid = await request("/jobs/invalid-id");
    expect(invalid.status).toBe(400);
    const missing = await request("/jobs/000000000000000000000000");
    expect(missing.status).toBe(404);
  });

  it("processes native Jobs using captured application services", async () => {
    await expect
      .poll(async () => {
        const response = await request(`/jobs/${app.jobId}`, { headers: viewer });

        return JobDtoSchema.parse(await response.json()).status;
      })
      .toBe("completed");
    await expect(
      app.db.collection<{ _id: string }>("receipts").countDocuments({ _id: app.jobId }),
    ).resolves.toBe(1);
  });

  it("disposes Monque before closing the application database and listener", async () => {
    const closeClient = app.client.close.bind(app.client);
    vi.spyOn(app.client, "close").mockImplementation(async () => {
      await expect(app.monque.getJob(app.jobId)).rejects.toThrow(/disposed/iu);
      await expect(app.db.command({ ping: 1 })).resolves.toMatchObject({ ok: 1 });
      await closeClient();
    });
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await expect(fetch(`${app.url}/custom/control/api/v1/health`)).rejects.toThrow(
      /fetch failed/iu,
    );
    await expect(app.db.command({ ping: 1 })).rejects.toThrow(/connected/iu);
  });

  it("blocks operator mutations in read-only mode", async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    scope = Scope.makeUnsafe();
    app = await acquire(true);
    const capabilities = await request("/capabilities");
    expect(CapabilitiesDtoSchema.parse(await capabilities.json())).toMatchObject({
      readOnly: true,
      actions: { cancel: false },
    });
    const denied = await request(`/jobs/${app.jobId}/actions/cancel`, { method: "POST" });
    expect(denied.status).toBe(403);
  });

  it("exports native Worker spans through a provider owned outside the host", async () => {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    scope = Scope.makeUnsafe();
    const exporter = new InMemorySpanExporter();

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    const providerShutdown = vi.spyOn(provider, "shutdown");
    await Effect.runPromise(
      Effect.addFinalizer(() =>
        Effect.promise(async () => {
          await expect(app.db.command({ ping: 1 })).rejects.toThrow(/connected/iu);
          await provider.shutdown();
        }),
      ).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    app = await acquire(false, openTelemetry(provider));
    await expect
      .poll(async () => {
        const job = await app.monque.getJob(app.jobId);

        return job?.status;
      })
      .toBe("completed");
    await app.monque.dispose();
    provider.getTracer("host").startSpan("host-still-active").end();
    await provider.forceFlush();
    expect(exporter.getFinishedSpans().map((span) => span.name)).toStrictEqual(
      expect.arrayContaining(["monque.worker", "host-still-active"]),
    );
    expect(providerShutdown).not.toHaveBeenCalled();
    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});
