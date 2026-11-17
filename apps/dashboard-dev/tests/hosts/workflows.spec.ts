import { expect, test } from "./fixture.js";

test("built Dashboard deep links read and mutate over RPC", async ({ page, app }) => {
  const job = await app.seed();
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/control/rpc/")) {
      calls.push(request.url());
    }
  });
  await page.goto(`${app.url}/ui/jobs/${job._id.toHexString()}`);
  await expect(page.getByRole("heading", { name: "email", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Payload", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  const response = await app.request.get(`${app.url}/control/api/v1/jobs/${job._id.toHexString()}`);
  expect(response.status()).toBe(200);
  expect(calls.some((url) => url.endsWith("/job"))).toBe(true);
  expect(calls.some((url) => url.includes("cancelJob"))).toBe(true);
  await page.goto(`${app.url}/ui/queue-views/email`);
  await expect(page.getByRole("heading", { name: "email", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("pagination survives reload and polling observes external mutations", async ({
  page,
  app,
}) => {
  await Promise.all(Array.from({ length: 55 }, async () => await app.seed()));
  await page.goto(`${app.url}/ui/jobs?name=email`);
  await expect(page.locator("tbody tr")).toHaveCount(50);
  await page.getByRole("link", { name: "Next page", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await page.reload();
  await expect(page.locator("tbody tr")).toHaveCount(5);
  const job = await app.seed({ name: "polling" });
  await page.goto(`${app.url}/ui/jobs/${job._id.toHexString()}`);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();

  const response = await app.request.post(
    `${app.url}/control/api/v1/jobs/${job._id.toHexString()}/actions/cancel`,
  );

  expect(response.status()).toBe(200);
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("host authentication protects HTML, assets and API; identities have distinct capabilities", async ({
  browser,
  app,
}) => {
  const anonymous = await browser.newContext({
    httpCredentials: { username: "invalid", password: "invalid" },
  });

  const viewer = await browser.newContext({
    httpCredentials: { username: "viewer", password: "viewer-secret" },
  });

  try {
    await Promise.all(
      [
        "/ui/jobs",
        "/ui/assets/missing.js",
        "/control/api/v1/jobs",
        "/control/rpc/capabilities",
        "/control/openapi.json",
      ].map(async (path) => {
        const response = await anonymous.request.get(`${app.url}${path}`);
        expect(response.status()).toBe(401);
      }),
    );

    const job = await app.seed();
    const page = await viewer.newPage();
    await page.goto(`${app.url}/ui/health`);
    await expect(page.getByText("1 of 9 available")).toBeVisible();
    await page.goto(`${app.url}/ui/jobs/${job._id.toHexString()}`);
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();

    const denied = await viewer.request.post(
      `${app.url}/control/api/v1/jobs/${job._id.toHexString()}/actions/cancel`,
    );

    expect(denied.status()).toBe(403);

    const deletion = await app.request.delete(
      `${app.url}/control/api/v1/jobs/${job._id.toHexString()}`,
    );

    expect(deletion.status()).toBe(403);
    const capabilities = await app.request.get(`${app.url}/control/api/v1/capabilities`);
    expect(await capabilities.json()).toMatchObject({ actions: { cancel: true, delete: false } });
  } finally {
    await anonymous.close();
    await viewer.close();
  }
});

test.describe("effective read-only host", () => {
  test.use({ readOnly: true });
  test("operator UI and direct mutation agree", async ({ page, app }) => {
    const job = await app.seed();
    await page.goto(`${app.url}/ui/health`);
    await expect(page.getByRole("heading", { name: "Read-only access" })).toBeVisible();

    await page.goto(`${app.url}/ui/jobs/${job._id.toHexString()}`);
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();

    const response = await app.request.post(
      `${app.url}/control/api/v1/jobs/${job._id.toHexString()}/actions/cancel`,
    );

    expect(response.status()).toBe(403);
  });
});

test.describe("host authorization hook failure", () => {
  test.use({ hookFailure: true });
  test("fails closed without exposing host details", async ({ app, page }) => {
    await page.goto(`${app.url}/ui/jobs`);
    await expect(page.getByText(/Internal server error/iu).first()).toBeVisible();

    const job = await app.seed();

    const response = await app.request.post(
      `${app.url}/control/api/v1/jobs/${job._id.toHexString()}/actions/cancel`,
    );

    expect(response.status()).toBe(500);
    expect(await response.text()).not.toContain("private policy failure");
  });
});
