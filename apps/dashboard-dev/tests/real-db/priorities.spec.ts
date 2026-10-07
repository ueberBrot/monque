import { expect, test } from "./fixture.js";

test("Job tables and details display signed and legacy priorities without list payloads", async ({
  page,
  app,
  isMobile,
}) => {
  const urgent = await app.seed({ name: "urgent", priority: 12 });
  const background = await app.seed({ name: "background", priority: -7 });
  const legacy = await app.seed({ name: "legacy" });
  const detailRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/v1\/jobs\/[a-f0-9]{24}(?:\?|$)/.test(request.url()))
      detailRequests.push(request.url());
  });
  const listResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/v1/jobs") && url.searchParams.get("view") === "summary";
  });
  await page.goto(`${app.base}/dashboard/jobs`);
  const list = await (await listResponse).json();
  expect(list.jobs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: urgent._id.toHexString(), priority: 12, payload: null }),
      expect.objectContaining({ id: background._id.toHexString(), priority: -7, payload: null }),
      expect.objectContaining({ id: legacy._id.toHexString(), priority: 0, payload: null }),
    ]),
  );
  for (const [name, priority] of [
    ["urgent", 12],
    ["background", -7],
    ["legacy", 0],
  ] as const) {
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name, exact: true }) });
    await expect(
      row.getByText(isMobile ? `Priority ${priority}` : String(priority), { exact: true }),
    ).toBeVisible();
  }
  await page.goto(`${app.base}/dashboard/queue-views/urgent`);
  await expect(page.getByRole("columnheader", { name: "Priority", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "12", exact: true })).toBeVisible();
  expect(detailRequests).toEqual([]);
  for (const [job, priority] of [
    [urgent, 12],
    [background, -7],
    [legacy, 0],
  ] as const) {
    await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
    await expect(page.getByRole("term").filter({ hasText: /^Priority$/ })).toBeInViewport();
    await expect(
      page
        .getByRole("term")
        .filter({ hasText: /^Priority$/ })
        .locator("..")
        .getByRole("definition"),
    ).toHaveText(String(priority));
  }
  await page.goto(`${app.origin}/readonly/dashboard/jobs/${urgent._id}`);
  await expect(
    page
      .getByRole("term")
      .filter({ hasText: /^Priority$/ })
      .locator("..")
      .getByRole("definition"),
  ).toHaveText("12");
});

test("single priority confirmation refreshes the Job and preserves unrelated selections", async ({
  page,
  app,
  isMobile,
}) => {
  const first = await app.seed({ name: "first-priority", priority: 2 });
  const other = await app.seed({ name: "other-priority", priority: 0 });
  await page.goto(`${app.base}/dashboard/jobs`);
  const selected = page.getByRole("checkbox", {
    name: `Select job row other-priority ${other._id}`,
  });
  await selected.check();
  await page.getByRole("button", { name: `Actions for ${first._id}` }).click();
  await page.getByRole("menuitem", { name: "Change job priority", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(first._id.toHexString());
  const input = page.getByRole("spinbutton", { name: "Priority", exact: true });
  await expect(input).toHaveValue("2");
  await expect(input).toHaveAccessibleDescription(/The default is 0/);
  await expect(page.getByRole("dialog")).toContainText("Among due jobs with the same name");
  await input.fill("14");
  await expect(page.getByRole("dialog")).toContainText("Current priority: 2");
  expect((await app.monque.getJob(first._id))?.priority).toBe(2);
  await page.getByRole("button", { name: "Confirm priority change", exact: true }).click();
  await expect(page.getByText("Job priority changed", { exact: true })).toBeVisible();
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "first-priority", exact: true }) });
  await expect(row.getByText(isMobile ? "Priority 14" : "14", { exact: true })).toBeVisible();
  await expect(selected).toBeChecked();
  expect((await app.monque.getJob(first._id))?.priority).toBe(14);
  expect((await app.monque.getJob(other._id))?.priority).toBe(0);
  await page.getByRole("link", { name: "first-priority", exact: true }).click();
  await page.getByRole("button", { name: "Change priority", exact: true }).click();
  await input.fill("-9");
  await page.getByRole("button", { name: "Confirm priority change", exact: true }).click();
  await expect(
    page
      .getByRole("term")
      .filter({ hasText: /^Priority$/ })
      .locator("..")
      .getByRole("definition"),
  ).toHaveText("-9");
  expect((await app.monque.getJob(first._id))?.priority).toBe(-9);
});

for (const change of ["cancelled", "missing", "denied"] as const) {
  test(`priority confirmation reports ${change} Jobs without a successful change`, async ({
    page,
    app,
    context,
  }) => {
    const job = await app.seed({ name: "priority-conflict", priority: 4 });
    await context.request.post(`${app.origin}/auth/login`, {
      data: { username: "operator", password: "fixture-password" },
    });
    await page.goto(`${app.origin}/private/dashboard/jobs/${job._id}`);
    await page.getByRole("button", { name: "Change priority", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Priority", exact: true }).fill("22");
    // Stop fresh reads until the stale confirmation reaches the authoritative server.
    const resumeReads = Promise.withResolvers<void>();
    await page.route(`**/private/api/v1/jobs/${job._id}`, async (route) => {
      if (route.request().method() === "GET") await resumeReads.promise;
      await route.continue();
    });
    try {
      if (change === "cancelled") await app.monque.cancelJob(job._id.toHexString());
      else if (change === "missing") await app.monque.deleteJob(job._id.toHexString());
      else {
        const cookie = (await context.cookies()).find((cookie) => cookie.name === "session");
        const session = app.sessions.get(cookie?.value ?? "");
        if (!session) throw new Error("Missing operator session");
        session.role = "viewer";
      }
      const response = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`/jobs/${job._id}/actions/priority`),
      );
      await page.getByRole("button", { name: "Confirm priority change", exact: true }).click();
      expect((await response).status()).toBe(
        change === "cancelled" ? 409 : change === "missing" ? 404 : 403,
      );
    } finally {
      resumeReads.resolve();
    }
    await expect(
      page
        .getByText(
          change === "cancelled"
            ? "State conflict"
            : change === "missing"
              ? "Job not found"
              : "Action unavailable",
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(page.getByText("Job priority changed", { exact: true })).not.toBeVisible();
    const current = await app.monque.getJob(job._id);
    if (change === "missing") expect(current).toBeNull();
    else expect(current?.priority).toBe(4);
    if (change === "denied")
      await expect(
        page.getByRole("button", { name: "Change priority", exact: true }),
      ).toBeDisabled();
  });
}

test("priority controls are unavailable for non-pending Jobs and read-only hosts", async ({
  page,
  app,
}) => {
  for (const status of ["processing", "completed", "failed", "cancelled"] as const) {
    const job = await app.seed({ name: `priority-${status}`, status });
    await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
    await expect(page.getByRole("button", { name: "Change priority", exact: true })).toBeDisabled();
  }
  const pending = await app.seed();
  await page.goto(`${app.origin}/readonly/dashboard/jobs/${pending._id}`);
  await expect(page.getByRole("button", { name: "Change priority", exact: true })).toBeDisabled();
});
