import type { FileRoutesByFullPath } from "@/routeTree.gen";

import { forEachSequential } from "../setup/sequential.js";
import { expect, test } from "./fixture.js";

test("Management authentication protects data while independently served Dashboard assets stay public", async ({
  app,
  context,
  page,
}) => {
  const job = await app.seed({ data: { marker: "private-payload-marker" } });
  const base = `${app.origin}/api-auth`;

  const routes = {
    "/": "Authentication required",
    "/queue-views": "Authentication required",
    "/queue-views/$name": "Authentication required",
    "/jobs": "Sign in required",
    "/jobs/$jobId": "Sign in required",
    "/health": "Authentication required",
  } satisfies Record<keyof FileRoutesByFullPath, string>;

  const apiPaths = [
    "/api/v1/capabilities",
    "/api/v1/health",
    "/api/v1/processing",
    "/api/v1/queue-views",
    "/api/v1/jobs",
    `/api/v1/jobs/${job._id.toHexString()}`,
    "/openapi.json",
  ];

  await context.clearCookies();
  await forEachSequential(Object.entries(routes), async ([route, heading]) => {
    const path = route.replace("$jobId", job._id.toHexString()).replace("$name", job.name);
    const response = await page.goto(`${base}/dashboard${path}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("private-payload-marker");
  });

  const assets = await page
    .locator(
      'script[type="module"][src], link[rel="modulepreload"][href], link[rel="stylesheet"][href]',
    )
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("src") ?? element.getAttribute("href")),
    );

  expect(assets.length).toBeGreaterThan(0);
  await forEachSequential(assets, async (asset) => {
    if (asset === null || asset === undefined || asset === "") {
      throw new Error("Missing built Dashboard asset URL");
    }

    const response = await context.request.get(new URL(asset, page.url()).href);
    expect(response.status()).toBe(200);
  });
  await forEachSequential(apiPaths, async (path) => {
    const response = await context.request.get(`${base}${path}`);
    expect(response.status()).toBe(401);
    expect(await response.text()).not.toContain("private-payload-marker");
  });

  const deniedCancel = await context.request.post(
    `${base}/api/v1/jobs/${job._id.toHexString()}/actions/cancel`,
  );

  expect(deniedCancel.status()).toBe(401);

  const login = await context.request.post(`${app.origin}/auth/login`, {
    data: { username: "operator", password: "fixture-password" },
  });

  expect(login.status()).toBe(204);
  await forEachSequential(apiPaths, async (path) => {
    const response = await context.request.get(`${base}${path}`);
    expect(response.status()).toBe(200);
  });
  await page.goto(`${base}/dashboard/jobs/${job._id.toHexString()}`);
  await expect(page.getByRole("heading", { name: job.name, exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText("private-payload-marker");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();

  const logout = await context.request.post(`${app.origin}/auth/logout`);
  expect(logout.status()).toBe(204);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in required", exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("private-payload-marker");
  await forEachSequential(apiPaths, async (path) => {
    const response = await context.request.get(`${base}${path}`);
    expect(response.status()).toBe(401);
  });

  const deniedCancelAfterLogout = await context.request.post(
    `${base}/api/v1/jobs/${job._id.toHexString()}/actions/cancel`,
  );

  expect(deniedCancelAfterLogout.status()).toBe(401);
  await forEachSequential(Object.keys(routes), async (route) => {
    const path = route.replace("$jobId", job._id.toHexString()).replace("$name", job.name);
    const response = await context.request.get(`${base}/dashboard${path}`);
    expect(response.status()).toBe(200);
  });
  await forEachSequential(assets, async (asset) => {
    if (asset === null || asset === undefined || asset === "") {
      throw new Error("Missing built Dashboard asset URL");
    }

    const response = await context.request.get(new URL(asset, page.url()).href);
    expect(response.status()).toBe(200);
  });
});
