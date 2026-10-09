import { forEachSequential } from "../setup/sequential.js";
import { expect, test } from "./fixture.js";

test("host login rejects bad credentials, protects assets, and logout invalidates all tabs", async ({
  page,
  app,
  context,
}) => {
  await app.seedScenario("mixed");
  await context.clearCookies();
  const login = async (password: string) =>
    await Promise.resolve(
      context.request.post(`${app.origin}/auth/login`, {
        data: { username: "operator", password },
      }),
    );
  const awaitedResult4 = await login("incorrect");
  expect(awaitedResult4.status()).toBe(401);
  expect(await context.cookies()).toEqual([]);
  await forEachSequential(
    ["/private/dashboard/jobs", "/private/api/v1/jobs", "/private/openapi.json"],
    async (path) => {
      const awaitedResult1 = await context.request.get(`${app.origin}${path}`);
      expect(awaitedResult1.status()).toBe(401);
    },
  );
  const awaitedResult5 = await login("fixture-password");
  expect(awaitedResult5.status()).toBe(204);
  const awaitedResult6 = await context.cookies();
  const cookie = awaitedResult6.find((currentCookie1) => currentCookie1.name === "session");
  if (!cookie) {
    throw new Error("Login did not set session cookie");
  }
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  await page.goto(`${app.origin}/private/dashboard/jobs`);
  await expect(page.locator("tbody tr")).toHaveCount(45);
  const asset = await page.locator('script[type="module"][src]').getAttribute("src");
  if (asset === undefined || asset === null || asset === "") {
    throw new Error("Missing production JavaScript asset");
  }
  const assetUrl = new URL(asset, page.url()).href;
  const awaitedResult7 = await context.request.get(assetUrl);
  expect(awaitedResult7.status()).toBe(200);
  const secondTab = await context.newPage();
  await secondTab.goto(`${app.origin}/private/dashboard/health`);
  await expect(secondTab.getByRole("heading", { name: "Health", exact: true })).toBeVisible();
  const awaitedResult8 = await context.request.post(`${app.origin}/auth/logout`);
  expect(awaitedResult8.status()).toBe(204);
  await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
  await expect(secondTab.getByRole("heading", { name: "Authentication required" })).toBeVisible();
  await forEachSequential([cookie.value, `${cookie.value}-tampered`], async (value) => {
    await context.addCookies([{ ...cookie, value }]);
    const awaitedResult2 = await context.request.get(assetUrl);
    expect(awaitedResult2.status()).toBe(401);
    const awaitedResult3 = await context.request.get(`${app.origin}/private/api/v1/jobs`);
    expect(awaitedResult3.status()).toBe(401);
  });
  const awaitedResult9 = await login("fixture-password");
  expect(awaitedResult9.status()).toBe(204);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(45);
  await secondTab.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(secondTab.getByRole("heading", { name: "Health", exact: true })).toBeVisible();
  await secondTab.close();
});
test("expired sessions stop reads and mutations; fresh login restores access", async ({
  page,
  app,
  context,
}) => {
  const job = await app.seed();
  await context.clearCookies();
  const login = async () =>
    await Promise.resolve(
      context.request.post(`${app.origin}/auth/login`, {
        data: { username: "operator", password: "fixture-password" },
      }),
    );
  const awaitedResult10 = await login();
  expect(awaitedResult10.status()).toBe(204);
  await page.goto(`${app.origin}/private/dashboard/jobs/${String(job._id)}`);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  const awaitedResult11 = await context.cookies();
  const cookie = awaitedResult11.find((currentCookie2) => currentCookie2.name === "session");
  const session = app.sessions.get(cookie?.value ?? "");
  if (!session) {
    throw new Error("Missing server session");
  }
  session.expiresAt = Date.now() - 1;
  await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
  const failedCancelResponse = await context.request.post(
    `${app.origin}/private/api/v1/jobs/${String(job._id)}/actions/cancel`,
  );
  expect(failedCancelResponse.status()).toBe(401);
  const awaitedResult12 = await app.monque.getJob(job._id);
  expect(awaitedResult12?.status).toBe("pending");
  const awaitedResult13 = await login();
  expect(awaitedResult13.status()).toBe(204);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
});
test("viewer login denies every mutation and revoked read permission produces access denied", async ({
  page,
  app,
  context,
}) => {
  const jobs = await app.seedScenario("mutations");
  const job = jobs.at(-1);
  if (!job) {
    throw new Error("Missing mutation job");
  }
  await context.clearCookies();
  const awaitedResult15 = await context.request.post(`${app.origin}/auth/login`, {
    data: { username: "viewer", password: "fixture-password" },
  });
  expect(awaitedResult15.status()).toBe(204);
  await page.goto(`${app.origin}/private/dashboard/jobs/${String(job._id)}`);
  await forEachSequential(["Cancel", "Retry", "Reschedule", "Delete job"], async (action) => {
    await expect(page.getByRole("button", { name: action, exact: true })).toBeDisabled();
  });
  await forEachSequential(["cancel", "retry", "reschedule"], async (action) => {
    const deniedActionResponse = await context.request.post(
      `${app.origin}/private/api/v1/jobs/${String(job._id)}/actions/${action}`,
      { data: { nextRunAt: "2035-01-01T00:00:00Z" } },
    );
    expect(deniedActionResponse.status()).toBe(403);
  });
  const deniedDeleteResponse = await context.request.delete(
    `${app.origin}/private/api/v1/jobs/${String(job._id)}`,
  );
  expect(deniedDeleteResponse.status()).toBe(403);
  await forEachSequential(["cancel", "retry", "delete"], async (action) => {
    const awaitedResult14 = await context.request.post(
      `${app.origin}/private/api/v1/jobs/actions/${action}`,
      {
        data: { name: "email" },
      },
    );
    expect(awaitedResult14.status()).toBe(403);
  });
  expect(await app.jobs.countDocuments()).toBe(12);
  const awaitedResult16 = await app.monque.getJob(job._id);
  expect(awaitedResult16?.status).toBe("pending");
  const awaitedResult17 = await context.cookies();
  const cookie = awaitedResult17.find((currentCookie3) => currentCookie3.name === "session");
  const session = app.sessions.get(cookie?.value ?? "");
  if (!session) {
    throw new Error("Missing viewer session");
  }
  session.role = "blocked";
  await expect(page.getByRole("heading", { name: "Job detail is forbidden" })).toBeVisible();
  const awaitedResult18 = await context.request.get(`${app.origin}/private/api/v1/jobs`);
  expect(awaitedResult18.status()).toBe(403);
});
