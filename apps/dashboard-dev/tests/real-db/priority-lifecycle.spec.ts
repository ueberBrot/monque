import { expect, test } from "./fixture.js";

test("Management and Dashboard retain priorities for retried batches and recurring runs", async ({
  page,
  app,
  isMobile,
}) => {
  await app.monque.enqueueMany([
    { name: "batch-priority", data: { source: "batch" }, priority: -11 },
  ]);
  const [batch] = await app.monque.getJobs({ name: "batch-priority" });
  if (!batch) throw new Error("Expected batch Job");
  await app.monque.cancelJob(batch._id.toHexString());
  await app.monque.retryJob(batch._id.toHexString());
  const recurring = await app.monque.schedule(
    "0 9 * * *",
    "recurring-priority",
    { source: "schedule" },
    { priority: 21, timezone: "UTC" },
  );
  app.monque.register("recurring-priority", () => {});
  await app.monque.rescheduleJob(recurring._id.toHexString(), new Date(0));
  const completed = new Promise<void>((resolve) =>
    app.monque.once("job:complete", () => resolve()),
  );
  app.monque.start();
  await completed;
  app.monque.pause();

  const summaryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/v1/jobs") && url.searchParams.get("view") === "summary";
  });
  await page.goto(`${app.base}/dashboard/jobs`);
  expect((await (await summaryResponse).json()).jobs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: batch._id.toHexString(),
        priority: -11,
        status: "pending",
        payload: null,
      }),
      expect.objectContaining({
        id: recurring._id.toHexString(),
        priority: 21,
        status: "pending",
        payload: null,
      }),
    ]),
  );
  for (const [job, priority] of [
    [batch, -11],
    [recurring, 21],
  ] as const) {
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: job.name, exact: true }) });
    await expect(
      row.getByText(isMobile ? `Priority ${priority}` : String(priority), { exact: true }),
    ).toBeVisible();
  }
  for (const [job, priority] of [
    [batch, -11],
    [recurring, 21],
  ] as const) {
    const detailResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith(`/api/v1/jobs/${job._id}`),
    );
    await page.goto(`${app.base}/dashboard/jobs/${job._id}`);
    expect(await (await detailResponse).json()).toMatchObject({ priority, status: "pending" });
    await expect(
      page
        .getByRole("term")
        .filter({ hasText: /^Priority$/ })
        .locator("..")
        .getByRole("definition"),
    ).toHaveText(String(priority));
  }
});
