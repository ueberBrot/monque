import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as DashboardModule from "@monque/dashboard";
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, vi, it } from "vite-plus/test";

import type { DashboardExpressRouterOptions } from "@/index";

const dashboardAssetMetadata = {
  assetDirectory: "client",
  htmlEntrypoint: "index.html",
  manifestPath: ".vite/manifest.json",
  runtimeConfigGlobal: "__MONQUE_DASHBOARD_CONFIG__",
  runtimeConfigScriptId: "monque-dashboard-runtime-config",
} as const;

const dashboardHtmlTemplate = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '  <meta charset="UTF-8" />',
  '  <script id="monque-dashboard-runtime-config">',
  "    window.__MONQUE_DASHBOARD_CONFIG__ = {",
  "      basePath: '/',",
  "      apiBaseUrl: '/',",
  "      pollingIntervalMs: 5000",
  "    };",
  "  </script>",
  "</head>",
  "<body>",
  '  <div id="app"></div>',
  '  <script type="module" src="./assets/index-abc12345.js"></script>',
  "</body>",
  "</html>",
].join("\n");

interface DashboardAppOptions {
  readonly apiBaseUrl?: DashboardExpressRouterOptions["apiBaseUrl"];
  readonly mountPath?: string;
  readonly pollingIntervalMs?: number;
}

const createRouterOptions = function createRouterOptions(
  options: DashboardAppOptions,
): DashboardExpressRouterOptions {
  const apiBaseUrl = options.apiBaseUrl ?? "/management/api/v1";

  if (options.pollingIntervalMs === undefined) {
    return { apiBaseUrl };
  }

  return {
    apiBaseUrl,
    pollingIntervalMs: options.pollingIntervalMs,
  };
};

describe("Dashboard Express Adapter", () => {
  let assetDirectory: string;
  let htmlEntrypointPath: string;

  beforeEach(async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), "monque-dashboard-express-"));
    assetDirectory = tempDirectory;
    htmlEntrypointPath = path.join(tempDirectory, "index.html");

    await mkdir(path.join(tempDirectory, "assets"));
    await writeFile(htmlEntrypointPath, dashboardHtmlTemplate);
    await writeFile(
      path.join(tempDirectory, "assets", "index-abc12345.js"),
      'console.log("dashboard");',
    );
  });

  afterEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(assetDirectory, { force: true, recursive: true });
  });

  const createDashboardApp = async function createDashboardApp(
    options: DashboardAppOptions = {},
  ): Promise<Express> {
    vi.doMock(import("@monque/dashboard"), async (importOriginal) => ({
      ...(await importOriginal<typeof DashboardModule>()),
      getDashboardAssetDirectory: () => assetDirectory,
      getDashboardAssetMetadata: () => dashboardAssetMetadata,
      getDashboardHtmlEntrypointPath: () => htmlEntrypointPath,
    }));

    const { createDashboardExpressRouter } = await import("@/index");

    const app = express();
    app.use(
      options.mountPath ?? "/dashboard",
      createDashboardExpressRouter(createRouterOptions(options)),
    );

    return app;
  };

  it("serves SPA HTML with mount-aware runtime config injection", async () => {
    const app = await createDashboardApp({ pollingIntervalMs: 15_000 });

    const response = await request(app)
      .get("/dashboard/jobs")
      .expect(200)
      .expect("content-type", /html/u);

    expect(response.text).toContain('"basePath":"/dashboard"');
    expect(response.text).toContain('"apiBaseUrl":"/management/api/v1"');
    expect(response.text).toContain('"pollingIntervalMs":15000');
    expect(response.headers["cache-control"]).not.toContain("max-age=31536000");
  });

  it("serves hashed static assets with immutable long-cache headers", async () => {
    const app = await createDashboardApp();

    const response = await request(app)
      .get("/dashboard/assets/index-abc12345.js")
      .expect(200)
      .expect("content-type", /javascript/u);

    expect(response.text).toBe('console.log("dashboard");');
    expect(response.headers["cache-control"]).toContain("public");
    expect(response.headers["cache-control"]).toContain("max-age=31536000");
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  it.each(["/ops/$&", "/ops/$$", "/ops/$`", "/ops/$'", "/ops/</script>"])(
    "preserves literal runtime config values for %s",
    async (apiBaseUrl) => {
      const app = await createDashboardApp({ apiBaseUrl });
      const response = await request(app).get("/dashboard/jobs").expect(200);
      const script =
        /<script id="monque-dashboard-runtime-config">(?<script>[\s\S]*?)<\/script>/u.exec(
          response.text,
        )?.[1];
      expect(script).toBeDefined();
      const config = script?.match(
        /window\.__MONQUE_DASHBOARD_CONFIG__ = (?<config>[\s\S]*);/u,
      )?.[1];
      expect(JSON.parse(config ?? "")).toStrictEqual({ basePath: "/dashboard", apiBaseUrl });
    },
  );

  it.each(["/", "/ops/queue"])(
    "resolves assets from a deep link mounted at %s",
    async (mountPath) => {
      const app = await createDashboardApp({ mountPath });
      const prefix = mountPath === "/" ? "" : mountPath;
      const response = await request(app).get(`${prefix}/jobs/job-123`).expect(200);
      const source = /src="(?<source>[^"]+\.js)"/u.exec(response.text)?.[1];
      expect(source).toBe(`${prefix}/assets/index-abc12345.js`);
      await request(app)
        .get(source ?? "")
        .expect(200)
        .expect("content-type", /javascript/u);
    },
  );

  it("does not mount or proxy management API routes", async () => {
    const app = await createDashboardApp();

    const httpResponse1 = await request(app).get("/dashboard/api/v1/health");
    expect(httpResponse1).toMatchObject({ status: 404 });
  });

  it.each(["/queue-views/email.send", "/queue-views/email%2Esend", "/index.html", "/index%2Ehtml"])(
    "injects runtime configuration for %s",
    async (routePath) => {
      const app = await createDashboardApp();
      const response = await request(app).get(`/dashboard${routePath}`).expect(200);
      expect(response.text).toContain('"basePath":"/dashboard"');
      expect(response.text).toContain('src="/dashboard/assets/index-abc12345.js"');
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );

  it.each(["/assets/missing.js", "/favicon.ico", "/%69ndex.html", "/api", "/api/v1/jobs"])(
    "does not turn missing assets or Management routes into HTML: %s",
    async (routePath) => {
      const app = await createDashboardApp();
      const httpResponse2 = await request(app).get(`/dashboard${routePath}`);
      expect(httpResponse2).toMatchObject({ status: 404 });
    },
  );

  it("validates resolved runtime configuration before serving HTML", async () => {
    const app = await createDashboardApp({ apiBaseUrl: () => "", pollingIntervalMs: 0 });
    const httpResponse3 = await request(app).get("/dashboard/jobs");
    expect(httpResponse3).toMatchObject({ status: 500 });
  });

  it("derives root base path and supports api base URL resolvers", async () => {
    const app = await createDashboardApp({
      apiBaseUrl: ({ req }) => req.get("x-api-base-url") ?? "/api/v1",
      mountPath: "/",
    });

    const response = await request(app)
      .get("/jobs")
      .set("x-api-base-url", "/ops/api/v1")
      .expect(200);

    expect(response.text).toContain('"basePath":"/"');
    expect(response.text).toContain('"apiBaseUrl":"/ops/api/v1"');
    expect(response.text).not.toContain('"pollingIntervalMs"');
  });

  // oxlint-disable-next-line eslint/no-script-url -- Deliberately exercise rejection of an executable URL scheme.
  it.each(["http://[", "javascript:alert(1)", "   "])(
    "forwards invalid API base URL %j to the host error handler",
    async (apiBaseUrl) => {
      const app = await createDashboardApp({ apiBaseUrl: () => apiBaseUrl });
      // oxlint-disable-next-line promise/prefer-await-to-callbacks, anti-slop/no-unknown-parameters -- Express discovers four-argument error middleware and forwards arbitrary thrown values.
      // oxlint-disable-next-line promise/prefer-await-to-callbacks, anti-slop/no-unknown-parameters -- Express discovers four-argument error middleware and forwards arbitrary thrown values.
      app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
      });
      const response = await request(app).get("/dashboard/jobs").expect(500);
      expect(response.text).toContain("apiBaseUrl");
      expect(response.text).not.toContain('<div id="app">');
    },
  );

  it("forwards resolver errors and skips SPA fallback for non-GET requests", async () => {
    const app = await createDashboardApp({
      apiBaseUrl: () => {
        throw new Error("Resolver failed");
      },
    });

    // oxlint-disable-next-line promise/prefer-await-to-callbacks, anti-slop/no-unknown-parameters -- Express discovers four-argument error middleware and forwards arbitrary thrown values.
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    });

    const httpResponse4 = await request(app).get("/dashboard/jobs");
    expect(httpResponse4).toMatchObject({ status: 500, body: { error: "Resolver failed" } });

    const httpResponse5 = await request(app).post("/dashboard/jobs");
    expect(httpResponse5).toMatchObject({ status: 404 });
  });
});
