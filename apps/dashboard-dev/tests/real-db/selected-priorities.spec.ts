import { forEachSequential } from "../setup/sequential.js";
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
  await forEachSequential([first, second], async (job) => {
    await page
      .getByRole("checkbox", { name: `Select job row ${job.name} ${String(job._id)}` })
      .check();
  });
  await page
    .getByRole("button", { name: "Change priority for selected jobs", exact: true })
    .click();
  const confirm = page.getByRole("button", { name: "Confirm priority changes", exact: true });
  const input = page.getByRole("spinbutton", { name: "Priority", exact: true });
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await forEachSequential(
    [
      ["", "Enter a priority"],
      ["0.5", "Use a whole number"],
      ["9007199254740992", "Use a value closer to 0"],
    ] as const,
    async ([value, message]) => {
      await input.fill(value);
      await input.blur();
      await expect(input).toHaveAccessibleDescription(new RegExp(message, "u"));
      await expect(confirm).toBeDisabled();
    },
  );
  await input.fill("-18");
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.getByRole("dialog")).toContainText("Set priority to -18 for 2 selected jobs.");
  const awaitedResult2 = await app.monque.getJob(first._id);
  expect(awaitedResult2?.priority).toBe(2);
  const response = page.waitForResponse(
    (currentResponse1) =>
      currentResponse1.request().method() === "POST" &&
      currentResponse1.url().endsWith("/jobs/actions/selected"),
  );
  await confirm.click();
  const awaitedResult3 = await response;
  expect(await awaitedResult3.json()).toEqual({ count: 2, errors: [] });
  await expect(page.getByText("Job priorities changed", { exact: true })).toBeVisible();
  await forEachSequential([first, second], async (job) => {
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: job.name, exact: true }) });
    await expect(row.getByText(isMobile ? "Priority -18" : "-18", { exact: true })).toBeVisible();
    await expect(row.getByRole("checkbox")).not.toBeChecked();
    const awaitedResult1 = await app.monque.getJob(job._id);
    expect(awaitedResult1?.priority).toBe(-18);
  });
  const awaitedResult4 = await app.monque.getJob(untouched._id);
  expect(awaitedResult4?.priority).toBe(6);
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
  await forEachSequential([valid, stale, missing, denied], async (job) => {
    await page
      .getByRole("checkbox", { name: `Select job row ${job.name} ${String(job._id)}` })
      .check();
  });
  await page
    .getByRole("button", { name: "Change priority for selected jobs", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Priority", exact: true }).fill("23");
  await expect(page.getByRole("dialog")).toContainText("Set priority to 23 for 4 selected jobs.");
  const resumeReads: PromiseWithResolvers<void> = Promise.withResolvers();
  const received: PromiseWithResolvers<void> = Promise.withResolvers();
  const release: PromiseWithResolvers<void> = Promise.withResolvers();
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
    const response = page.waitForResponse((currentResponse2) =>
      currentResponse2.url().endsWith("/jobs/actions/selected"),
    );
    await page.getByRole("button", { name: "Confirm priority changes", exact: true }).click();
    await received.promise;
    await page
      .getByRole("checkbox", { name: `Select job row untouched ${String(untouched._id)}` })
      .check();
    release.resolve();
    const awaitedResult5 = await response;
    expect(await awaitedResult5.json()).toEqual({
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
  await expect(page.getByText(/1 succeeded, 3 failed\./u)).toBeVisible();
  await forEachSequential([stale, denied, untouched], async (job) => {
    await expect(
      page.getByRole("checkbox", { name: `Select job row ${job.name} ${String(job._id)}` }),
    ).toBeChecked();
  });
  await expect(
    page.getByRole("checkbox", { name: `Select job row valid ${String(valid._id)}` }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: `Select job row missing ${String(missing._id)}` }),
  ).toHaveCount(0);
  const validRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "valid", exact: true }) });
  await expect(validRow.getByText(isMobile ? "Priority 23" : "23", { exact: true })).toBeVisible();
  const awaitedResult6 = await app.monque.getJob(valid._id);
  expect(awaitedResult6?.priority).toBe(23);
  const awaitedResult7 = await app.monque.getJob(stale._id);
  expect(awaitedResult7?.priority).toBe(4);
  const awaitedResult8 = await app.monque.getJob(denied._id);
  expect(awaitedResult8?.priority).toBe(6);
  const awaitedResult9 = await app.monque.getJob(untouched._id);
  expect(awaitedResult9?.priority).toBe(7);
  await expect(
    page.getByRole("button", { name: "Change priority for selected jobs", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: `Select job row stale ${String(stale._id)}` }).uncheck();
  await expect(
    page.getByRole("button", { name: "Change priority for selected jobs", exact: true }),
  ).toBeEnabled();
  await page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname.endsWith("/jobs"),
  );
  await forEachSequential([denied, untouched], async (job) => {
    await expect(
      page.getByRole("checkbox", { name: `Select job row ${job.name} ${String(job._id)}` }),
    ).toBeChecked();
  });
});
test("selected priority requires all pending Jobs and an enabled host capability", async ({
  page,
  app,
}) => {
  const pending = await app.seed({ name: "pending" });
  const others = await Promise.all(
    (["processing", "completed", "failed", "cancelled"] as const).map(
      async (status) => await Promise.resolve(app.seed({ name: status, status })),
    ),
  );
  await page.goto(`${app.base}/dashboard/jobs`);
  const priority = page.getByRole("button", {
    name: "Change priority for selected jobs",
    exact: true,
  });
  await page
    .getByRole("checkbox", { name: `Select job row pending ${String(pending._id)}` })
    .check();
  await expect(priority).toBeEnabled();
  await forEachSequential(others, async (job) => {
    const checkbox = page.getByRole("checkbox", {
      name: `Select job row ${job.name} ${String(job._id)}`,
    });
    await checkbox.check();
    await expect(priority).toBeDisabled();
    await checkbox.uncheck();
    await expect(priority).toBeEnabled();
  });
  await page.goto(`${app.origin}/readonly/dashboard/jobs`);
  await page
    .getByRole("checkbox", { name: `Select job row pending ${String(pending._id)}` })
    .check();
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
  await forEachSequential([first, second], async (job) => {
    await page
      .getByRole("checkbox", { name: `Select job row ${job.name} ${String(job._id)}` })
      .check();
  });
  await page
    .getByRole("button", { name: "Change priority for selected jobs", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Priority", exact: true }).fill("12");
  const awaitedResult11 = await context.cookies();
  const cookie = awaitedResult11.find((currentCookie3) => currentCookie3.name === "session");
  const session = app.sessions.get(cookie?.value ?? "");
  if (!session) {
    throw new Error("Missing operator session");
  }
  session.role = "viewer";
  await page.getByRole("button", { name: "Confirm priority changes", exact: true }).click();
  await expect(page.getByText("Action unavailable", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change priority for selected jobs", exact: true }),
  ).toBeDisabled();
  await forEachSequential(
    [
      [first, 1],
      [second, 2],
    ] as const,
    async ([job, priority]) => {
      await expect(
        page.getByRole("checkbox", { name: `Select job row ${job.name} ${String(job._id)}` }),
      ).toBeChecked();
      const awaitedResult10 = await app.monque.getJob(job._id);
      expect(awaitedResult10?.priority).toBe(priority);
    },
  );
});
