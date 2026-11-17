/* oxlint-disable vitest/max-expects, unicorn/no-await-expression-member -- Verify the complete GET/HEAD response contract together at the public request seam. */
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { getDashboardAssetDirectory } from "@monque/dashboard";
import { Context, Effect, Layer, Path } from "effect";
import { Etag, HttpPlatform, HttpRouter, HttpServerRequest } from "effect/http";
import { describe, expect, it } from "vite-plus/test";

import { dashboardEffectLayer } from "../../src/index";

const makeApp = () =>
  HttpRouter.toWebHandler(
    dashboardEffectLayer({ basePath: "/ops/ui", apiBaseUrl: "/control" }).pipe(
      HttpRouter.provideRequest(
        Layer.mergeAll(
          HttpPlatform.layer.pipe(Layer.provide([NodeFileSystem.layer, Etag.layerWeak])),
          NodeFileSystem.layer,
          Path.layer,
        ),
      ),
    ),
  );

describe("Dashboard Effect", () => {
  it("serves configured deep links through a host-owned portable handler", async () => {
    const app = makeApp();

    try {
      const response = await app.handler(new Request("http://localhost/ops/ui/jobs/a.b"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const html = await response.text();
      expect(html).toContain('"basePath":"/ops/ui"');
      expect(html).toContain('"apiBaseUrl":"/control"');
      expect(html).toContain("/ops/ui/assets/");
    } finally {
      await app.dispose();
    }
  });

  it("serves immutable built assets and matching HEAD metadata without bodies", async () => {
    const app = makeApp();

    try {
      const html = await (await app.handler(new Request("http://localhost/ops/ui"))).text();
      const asset = /src="(?<asset>[^" ]+\.js)"/u.exec(html)?.groups?.["asset"];
      expect(asset).toMatch(/^\/ops\/ui\/assets\//u);
      const url = `http://localhost${asset}`;
      const get = await app.handler(new Request(url));
      const head = await app.handler(new Request(url, { method: "HEAD" }));
      expect(get.status).toBe(200);
      expect(get.headers.get("content-type")).toContain("javascript");
      expect(get.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(get.headers.get("content-length"));
      await expect(head.text()).resolves.toBe("");
      await expect(get.text()).resolves.not.toBe("");

      const htmlHead = await app.handler(
        new Request("http://localhost/ops/ui/queue-views/a.b", { method: "HEAD" }),
      );

      expect(htmlHead.headers.get("cache-control")).toBe("no-store");
      await expect(htmlHead.text()).resolves.toBe("");
    } finally {
      await app.dispose();
    }
  });

  it.each([
    "assets/missing.js",
    "assets",
    "api",
    "api/v1/jobs",
    "unknown.js",
    "assets/%2e%2e%2findex.html",
    "assets/%5cindex.js",
    "assets/%00.js",
    "%ZZ",
  ])("does not fall back or escape assets for %s", async (pathname) => {
    const app = makeApp();

    try {
      const response = await app.handler(new Request(`http://localhost/ops/ui/${pathname}`));
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.not.toContain("__MONQUE_DASHBOARD_CONFIG__");
    } finally {
      await app.dispose();
    }
  });

  it("does not serve writes or mount Management", async () => {
    const app = makeApp();

    try {
      expect(
        (await app.handler(new Request("http://localhost/ops/ui/jobs", { method: "POST" }))).status,
      ).toBe(404);
      expect((await app.handler(new Request("http://localhost/control/rpc/health"))).status).toBe(
        404,
      );
    } finally {
      await app.dispose();
    }
  });

  it("evaluates configuration with the host identity and current request", async () => {
    class Identity extends Context.Service<Identity, string>()("test/Identity") {}

    const app = HttpRouter.toWebHandler(
      dashboardEffectLayer({
        basePath: "/ui",
        apiBaseUrl: Effect.gen(function* resolveManagement() {
          const identity = yield* Identity;
          const request = yield* HttpServerRequest.HttpServerRequest;

          return `/${identity}/${request.headers["x-tenant"]}`;
        }),
      }).pipe(
        HttpRouter.provideRequest(
          Layer.mergeAll(
            NodeFileSystem.layer,
            Path.layer,
            HttpPlatform.layer.pipe(Layer.provide([NodeFileSystem.layer, Etag.layerWeak])),
            Layer.succeed(Identity, "operator"),
          ),
        ),
      ),
    );

    try {
      const response = await app.handler(
        new Request("http://localhost/ui/jobs/a.b", { headers: { "x-tenant": "tenant-a" } }),
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain('"apiBaseUrl":"/operator/tenant-a"');
    } finally {
      await app.dispose();
    }
  });

  it("rejects symlinks escaping the built asset root", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dashboard-secret-"));
    const link = path.join(getDashboardAssetDirectory(), "assets", "test-outside.txt");
    const app = makeApp();

    try {
      await writeFile(path.join(directory, "secret.txt"), "private host data");
      await symlink(path.join(directory, "secret.txt"), link);

      const response = await app.handler(
        new Request("http://localhost/ops/ui/assets/test-outside.txt"),
      );

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.not.toContain("private host data");
    } finally {
      await app.dispose();
      await rm(link, { force: true });
      await rm(directory, { recursive: true, force: true });
    }
  });
});
