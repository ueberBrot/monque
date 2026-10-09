import { JobCursorPageDtoSchema } from "@monque/management/contract";

import { forEachSequential } from "../setup/sequential.js";
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
  if (!batch) {
    throw new Error("Expected batch Job");
  }
  await app.monque.cancelJob(batch._id.toHexString());
  await app.monque.retryJob(batch._id.toHexString());
  const recurring = await app.monque.schedule(
    "0 9 * * *",
    "recurring-priority",
    { source: "schedule" },
    { priority: 21, timezone: "UTC" },
  );
  app.monque.register("recurring-priority", () => {
    // Completion alone is enough to observe the recurring schedule.
  });
  await app.monque.rescheduleJob(recurring._id.toHexString(), new Date(0));
  const { promise: completed, resolve: complete }: PromiseWithResolvers<void> =
    Promise.withResolvers();
  app.monque.once("job:complete", () => {
    complete();
  });
  app.monque.start();
  await completed;
  app.monque.pause();
  const summaryResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/v1/jobs") && url.searchParams.get("view") === "summary";
  });
  await page.goto(`${app.base}/dashboard/jobs`);
  const awaitedResult1 = await summaryResponse;
  const awaitedResult2 = JobCursorPageDtoSchema.parse(await awaitedResult1.json());
  expect(awaitedResult2.jobs).toEqual(
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
  await forEachSequential(
    [
      [batch, -11],
      [recurring, 21],
    ] as const,
    async ([job, priority]) => {
      const row = page
        .getByRole("row")
        .filter({ has: page.getByRole("link", { name: job.name, exact: true }) });
      await expect(
        row.getByText(isMobile ? `Priority ${priority}` : String(priority), { exact: true }),
      ).toBeVisible();
    },
  );
  await forEachSequential(
    [
      [batch, -11],
      [recurring, 21],
    ] as const,
    async ([job, priority]) => {
      const detailResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith(`/api/v1/jobs/${String(job._id)}`),
      );
      await page.goto(`${app.base}/dashboard/jobs/${String(job._id)}`);
      const currentAwaitedResult11 = await detailResponse;
      expect(await currentAwaitedResult11.json()).toMatchObject({ priority, status: "pending" });
      await expect(
        page
          .getByRole("term")
          .filter({ hasText: /^Priority$/u })
          .locator("..")
          .getByRole("definition"),
      ).toHaveText(String(priority));
    },
  );
});
