import { expect, test } from "./fixture.js";

for (const view of ["queue-views", "queue-views/email", "jobs", "job-detail", "health"]) {
  test(`${view} shows its own skeleton without blocking navigation`, async ({ page, app }) => {
    const job = await app.seed();
    const { promise: pending, resolve: release }: PromiseWithResolvers<void> =
      Promise.withResolvers();
    await page.route("**/api/v1/**", async (request) => {
      await pending;
      await request.continue();
    });
    const path = view === "job-detail" ? `jobs/${String(job._id)}` : view;
    await page.goto(`${app.base}/dashboard/${path}`);
    const label = (() => {
      if (view === "queue-views") {
        return "Loading Queue Views…";
      }
      if (view === "queue-views/email") {
        return "Loading Queue View…";
      }
      if (view === "jobs") {
        return "Loading jobs…";
      }
      if (view === "job-detail") {
        return "Loading job details…";
      }
      return "Loading Health…";
    })();
    const loading = page.getByRole("status", { name: label });
    await expect(loading).toBeVisible();
    await expect(page.getByRole("button", { name: /Commands/u })).toBeEnabled();
    expect(await loading.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    release();
    await expect(loading).toHaveCount(0);
    const heading = (() => {
      if (view === "queue-views") {
        return "Queue Views";
      }
      if (view === "jobs") {
        return "Jobs";
      }
      if (view === "health") {
        return "Health";
      }
      return "email";
    })();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  });
}
