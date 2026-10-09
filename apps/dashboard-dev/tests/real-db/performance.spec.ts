import { setTimeout } from "node:timers/promises";
import { JobCursorPageDtoSchema, JobDtoSchema } from "@monque/management/contract";
import { z } from "zod";

import { expect, test } from "./fixture.js";

test("listings omit payloads and queue detail avoids a second statistics request", async ({
  page,
  app,
}) => {
  const job = await app.seed({ data: { content: "x".repeat(16_384) } });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const listing = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/v1/jobs"),
  );
  await page.goto(`${app.base}/dashboard/queue-views/${job.name}`);
  const response = await listing;
  expect(new URL(response.url()).searchParams.get("view")).toBe("summary");
  const awaitedResult1 = JobCursorPageDtoSchema.parse(await response.json());
  expect(awaitedResult1.jobs[0]?.payload).toBeNull();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  expect(requests.some((url) => url.includes("/jobs/stats"))).toBe(false);
  const detail = await page.request.get(`${app.base}/api/v1/jobs/${String(job._id)}`);
  const awaitedResult2 = JobDtoSchema.parse(await detail.json());
  expect(z.object({ content: z.string() }).parse(awaitedResult2.payload).content).toHaveLength(
    16_384,
  );
});
test("a cold command search receives keyboard focus after its chunk loads", async ({
  page,
  app,
}) => {
  await app.seed();
  await page.route("**/command-search-*.js", async (route) => {
    await setTimeout(250);
    await route.continue();
  });
  await page.goto(`${app.base}/dashboard/jobs`);
  await page.getByRole("button", { name: /Commands/u }).click();
  await expect(page.getByRole("combobox", { name: "Search commands" })).toBeFocused();
  await page.keyboard.type("Health");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Health", exact: true })).toBeVisible();
});
