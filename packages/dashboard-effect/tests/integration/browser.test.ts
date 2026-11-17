import { chromium } from "playwright";
import { describe, expect, it } from "vite-plus/test";

import { startDashboardHost } from "./host";

describe("Effect Dashboard with Express Management", () => {
  it("loads authenticated deep links and performs an RPC mutation", async () => {
    const host = await startDashboardHost();
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage();
      const rpc: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/rpc/")) {
          rpc.push(request.url());
        }
      });
      const denied = await page.request.get(`${host.url}/custom/ui/assets/missing.js`);
      expect(denied.status()).toBe(401);
      await page.goto(`${host.url}/login/operator`);
      await page.getByRole("heading", { name: "receipt", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("heading", { name: "receipt", exact: true }).waitFor();
      await page.goto(`${host.url}/custom/ui/health`);
      await page.getByRole("button", { name: "Pause instance", exact: true }).click();
      await page.getByRole("button", { name: "Resume instance", exact: true }).waitFor();
      expect(rpc.some((url) => url.includes("pause"))).toBe(true);
      expect(rpc.some((url) => url.includes("health"))).toBe(true);
      await page.goto(`${host.url}/login/viewer`);
      await page.goto(`${host.url}/custom/ui/health`);
      await expect
        .poll(
          async () =>
            await page.getByRole("button", { name: "Resume instance", exact: true }).isDisabled(),
        )
        .toBe(true);
    } finally {
      await browser.close();
      await host.close();
    }
  }, 60_000);
});
