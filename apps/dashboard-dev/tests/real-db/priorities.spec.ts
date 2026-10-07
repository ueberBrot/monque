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
