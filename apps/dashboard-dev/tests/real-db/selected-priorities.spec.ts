import { expect, test } from "./fixture.js";

test("selected priority confirmation changes only the selected pending Jobs", async ({
  page,
  app,
  isMobile,
}) => {
  const first = await app.seed({ name: "selected-first", priority: 2 });
  const second = await app.seed({ name: "selected-second", priority: -4 });
  const untouched = await app.seed({ name: "untouched", priority: 6 });
  await page.goto(`${app.base}/dashboard/jobs`);
  for (const job of [first, second])
    await page.getByRole("checkbox", { name: `Select job row ${job.name} ${job._id}` }).check();
  await page
    .getByRole("button", { name: "Change priority for selected jobs", exact: true })
    .click();
  const confirm = page.getByRole("button", { name: "Confirm priority changes", exact: true });
  const input = page.getByRole("spinbutton", { name: "Priority", exact: true });
  await expect(input).toHaveAttribute("aria-invalid", "false");
  for (const [value, message] of [
    ["", "Enter a priority"],
    ["0.5", "Use a whole number"],
    ["9007199254740992", "Use a value closer to 0"],
  ] as const) {
    await input.fill(value);
    await input.blur();
    await expect(input).toHaveAccessibleDescription(new RegExp(message));
    await expect(confirm).toBeDisabled();
  }
  await input.fill("-18");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByRole("dialog")).toContainText("Set priority to -18 for 2 selected jobs.");
  expect((await app.monque.getJob(first._id))?.priority).toBe(2);
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith("/jobs/actions/selected"),
  );
  await confirm.click();
  expect(await (await response).json()).toEqual({ count: 2, errors: [] });
  await expect(page.getByText("Job priorities changed", { exact: true })).toBeVisible();
  for (const job of [first, second]) {
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: job.name, exact: true }) });
    await expect(row.getByText(isMobile ? "Priority -18" : "-18", { exact: true })).toBeVisible();
    await expect(row.getByRole("checkbox")).not.toBeChecked();
    expect((await app.monque.getJob(job._id))?.priority).toBe(-18);
  }
  expect((await app.monque.getJob(untouched._id))?.priority).toBe(6);
  await page.reload();
  await expect(page.getByText(isMobile ? "Priority -18" : "-18", { exact: true })).toHaveCount(2);
});

test("selected priority reports stale and denied Jobs and preserves failed and newer selections", async ({
  page,
  app,
  context,
  isMobile,
}) => {
  const valid = await app.seed({ name: "valid", priority: 3 });
  const stale = await app.seed({ name: "stale", priority: 4 });
  const missing = await app.seed({ name: "missing", priority: 5 });
  const denied = await app.seed({ name: "denied", priority: 6 });
  const untouched = await app.seed({ name: "untouched", priority: 7 });
  await context.request.post(`${app.origin}/auth/login`, {
    data: { username: "operator", password: "fixture-password" },
  });
  await page.goto(`${app.origin}/private/dashboard/jobs`);
  for (const job of [valid, stale, missing, denied])
    await page.getByRole("checkbox", { name: `Select job row ${job.name} ${job._id}` }).check();
  await page
    .getByRole("button", { name: "Change priority for selected jobs", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Priority", exact: true }).fill("23");
  await expect(page.getByRole("dialog")).toContainText("Set priority to 23 for 4 selected jobs.");
  const resumeReads = Promise.withResolvers<void>();
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route("**/private/api/v1/jobs?*", async (route) => {
    await resumeReads.promise;
    await route.continue();
  });
  await page.route("**/private/api/v1/jobs/actions/selected", async (route) => {
    received.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await app.monque.cancelJob(stale._id.toHexString());
    await app.monque.deleteJob(missing._id.toHexString());
    app.deniedPriorityJobIds.add(denied._id.toHexString());
    const response = page.waitForResponse((response) =>
      response.url().endsWith("/jobs/actions/selected"),
    );
    await page.getByRole("button", { name: "Confirm priority changes", exact: true }).click();
    await received.promise;
    await page.getByRole("checkbox", { name: `Select job row untouched ${untouched._id}` }).check();
    release.resolve();
    expect(await (await response).json()).toEqual({
      count: 1,
      errors: expect.arrayContaining([
        expect.objectContaining({ jobId: stale._id.toHexString(), status: 409 }),
        expect.objectContaining({ jobId: missing._id.toHexString(), status: 404 }),
        expect.objectContaining({ jobId: denied._id.toHexString(), status: 403 }),
      ]),
    });
  } finally {
    release.resolve();
    resumeReads.resolve();
  }
  await expect(page.getByText(/1 succeeded, 3 failed\./)).toBeVisible();
  for (const job of [stale, denied, untouched])
    await expect(
      page.getByRole("checkbox", { name: `Select job row ${job.name} ${job._id}` }),
    ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: `Select job row valid ${valid._id}` }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: `Select job row missing ${missing._id}` }),
  ).toHaveCount(0);
  const validRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "valid", exact: true }) });
  await expect(validRow.getByText(isMobile ? "Priority 23" : "23", { exact: true })).toBeVisible();
  expect((await app.monque.getJob(valid._id))?.priority).toBe(23);
  expect((await app.monque.getJob(stale._id))?.priority).toBe(4);
  expect((await app.monque.getJob(denied._id))?.priority).toBe(6);
  expect((await app.monque.getJob(untouched._id))?.priority).toBe(7);
  await expect(
    page.getByRole("button", { name: "Change priority for selected jobs", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: `Select job row stale ${stale._id}` }).uncheck();
  await expect(
    page.getByRole("button", { name: "Change priority for selected jobs", exact: true }),
  ).toBeEnabled();
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname.endsWith("/jobs"),
  );
  for (const job of [denied, untouched])
    await expect(
      page.getByRole("checkbox", { name: `Select job row ${job.name} ${job._id}` }),
    ).toBeChecked();
});

test("selected priority requires all pending Jobs and an enabled host capability", async ({
  page,
  app,
}) => {
  const pending = await app.seed({ name: "pending" });
  const others = await Promise.all(
    (["processing", "completed", "failed", "cancelled"] as const).map((status) =>
      app.seed({ name: status, status }),
    ),
  );
  await page.goto(`${app.base}/dashboard/jobs`);
  const priority = page.getByRole("button", {
    name: "Change priority for selected jobs",
    exact: true,
  });
  await page.getByRole("checkbox", { name: `Select job row pending ${pending._id}` }).check();
  await expect(priority).toBeEnabled();
  for (const job of others) {
    const checkbox = page.getByRole("checkbox", { name: `Select job row ${job.name} ${job._id}` });
    await checkbox.check();
    await expect(priority).toBeDisabled();
    await checkbox.uncheck();
    await expect(priority).toBeEnabled();
  }
  await page.goto(`${app.origin}/readonly/dashboard/jobs`);
  await page.getByRole("checkbox", { name: `Select job row pending ${pending._id}` }).check();
  await expect(priority).toBeDisabled();
});

test("selected priority reports a revoked operator session and leaves Jobs unchanged", async ({
  page,
  app,
  context,
}) => {
  const first = await app.seed({ name: "first", priority: 1 });
  const second = await app.seed({ name: "second", priority: 2 });
  await context.request.post(`${app.origin}/auth/login`, {
    data: { username: "operator", password: "fixture-password" },
  });
  await page.goto(`${app.origin}/private/dashboard/jobs`);
  for (const job of [first, second])
    await page.getByRole("checkbox", { name: `Select job row ${job.name} ${job._id}` }).check();
  await page
    .getByRole("button", { name: "Change priority for selected jobs", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Priority", exact: true }).fill("12");
  const cookie = (await context.cookies()).find((cookie) => cookie.name === "session");
  const session = app.sessions.get(cookie?.value ?? "");
  if (!session) throw new Error("Missing operator session");
  session.role = "viewer";
  await page.getByRole("button", { name: "Confirm priority changes", exact: true }).click();
  await expect(page.getByText("Action unavailable", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change priority for selected jobs", exact: true }),
  ).toBeDisabled();
  for (const [job, priority] of [
    [first, 1],
    [second, 2],
  ] as const) {
    await expect(
      page.getByRole("checkbox", { name: `Select job row ${job.name} ${job._id}` }),
    ).toBeChecked();
    expect((await app.monque.getJob(job._id))?.priority).toBe(priority);
  }
});
