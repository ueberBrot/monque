import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createManagementExpressRouter } from "@monque/management-express";
import express from "express";
import { createServer } from "vite-plus";
import { describe, expect, it, vi } from "vite-plus/test";

import { createDashboardManagementApi } from "@/management-client";

import { isString } from "../../../../packages/dashboard/src/lib/type-guards.js";

const unsupported = (): never => {
  throw new Error("Not used by health");
};

describe("live development proxy", () => {
  it("routes RPC and public HTTP to the configured Management mount", async () => {
    const app = express();
    app.disable("x-powered-by");
    app.use(
      "/ops",
      createManagementExpressRouter({
        monque: {
          isHealthy: () => true,
          getQueueViewSummaries: unsupported,
          getJobsWithCursor: unsupported,
          getJob: unsupported,
          getQueueStats: unsupported,
        },
      }),
    );
    const upstream = app.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const address = upstream.address();

    if (address === null || isString(address)) {
      throw new Error("Expected TCP listener");
    }

    vi.stubEnv("MONQUE_DASHBOARD_DEV_MODE", "live");
    vi.stubEnv("MONQUE_DASHBOARD_DEV_LIVE_API_BASE_URL", `http://127.0.0.1:${address.port}/ops`);
    let vite: Awaited<ReturnType<typeof createServer>> | undefined;

    try {
      vite = await createServer({
        configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
        server: { port: 0, host: "127.0.0.1" },
      });
      await vite.listen();
      const origin = vite.resolvedUrls?.local[0];

      if (origin === undefined) {
        throw new Error("Expected Vite listener");
      }

      const api = createDashboardManagementApi({ apiBaseUrl: "/api", origin });
      await expect(api.client.health()).resolves.toStrictEqual({
        status: "ok",
        scheduler: { healthy: true },
      });
      const response = await fetch(new URL("/api/v1/health", origin));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        status: "ok",
        scheduler: { healthy: true },
      });
    } finally {
      vi.unstubAllEnvs();
      await vite?.close();
      const closed = once(upstream, "close");
      upstream.close();
      await closed;
    }
  });
});
