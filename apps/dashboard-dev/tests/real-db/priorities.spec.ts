import { JobCursorPageDtoSchema } from "@monque/management/contract";

import { forEachSequential } from "../setup/sequential.js";
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
    if (/\/api\/v1\/jobs\/[a-f0-9]{24}(?:\?|$)/u.test(request.url())) {
      detailRequests.push(request.url());
    }
  });
  const listResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/v1/jobs") && url.searchParams.get("view") === "summary";
  });
  await page.goto(`${app.base}/dashboard/jobs`);
  const awaitedResult1 = await listResponse;
  const list = JobCursorPageDtoSchema.parse(await awaitedResult1.json());
  expect(list.jobs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: urgent._id.toHexString(), priority: 12, payload: null }),
      expect.objectContaining({ id: background._id.toHexString(), priority: -7, payload: null }),
      expect.objectContaining({ id: legacy._id.toHexString(), priority: 0, payload: null }),
    ]),
  );
  await forEachSequential(
    [
      ["urgent", 12],
      ["background", -7],
      ["legacy", 0],
    ] as const,
    async ([name, priority]) => {
      const row = page
        .getByRole("row")
        .filter({ has: page.getByRole("link", { name, exact: true }) });
      await expect(
        row.getByText(isMobile ? `Priority ${priority}` : String(priority), { exact: true }),
      ).toBeVisible();
    },
  );
  await page.goto(`${app.base}/dashboard/queue-views/urgent`);
  await expect(page.getByRole("columnheader", { name: "Priority", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "12", exact: true })).toBeVisible();
  expect(detailRequests).toEqual([]);
  await forEachSequential(
    [
      [urgent, 12],
      [background, -7],
      [legacy, 0],
    ] as const,
    async ([job, priority]) => {
      await page.goto(`${app.base}/dashboard/jobs/${String(job._id)}`);
      await expect(page.getByRole("term").filter({ hasText: /^Priority$/u })).toBeInViewport();
      await expect(
        page
          .getByRole("term")
          .filter({ hasText: /^Priority$/u })
          .locator("..")
          .getByRole("definition"),
      ).toHaveText(String(priority));
    },
  );
  await page.goto(`${app.origin}/readonly/dashboard/jobs/${String(urgent._id)}`);
  await expect(
    page
      .getByRole("term")
      .filter({ hasText: /^Priority$/u })
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
    name: `Select job row other-priority ${String(other._id)}`,
  });
  await selected.check();
  await page.getByRole("button", { name: `Actions for ${String(first._id)}` }).click();
  await page.getByRole("menuitem", { name: "Change job priority", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(first._id.toHexString());
  const input = page.getByRole("spinbutton", { name: "Priority", exact: true });
  await expect(input).toHaveValue("2");
  await expect(input).toHaveAccessibleDescription(/The default is 0/u);
  await expect(page.getByRole("dialog")).toContainText("Among due jobs with the same name");
  await input.fill("14");
  await expect(page.getByRole("dialog")).toContainText("Current priority: 2");
  const awaitedResult2 = await app.monque.getJob(first._id);
  expect(awaitedResult2?.priority).toBe(2);
  await page.getByRole("button", { name: "Confirm priority change", exact: true }).click();
  await expect(page.getByText("Job priority changed", { exact: true })).toBeVisible();
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "first-priority", exact: true }) });
  await expect(row.getByText(isMobile ? "Priority 14" : "14", { exact: true })).toBeVisible();
  await expect(selected).toBeChecked();
  const awaitedResult3 = await app.monque.getJob(first._id);
  expect(awaitedResult3?.priority).toBe(14);
  const awaitedResult4 = await app.monque.getJob(other._id);
  expect(awaitedResult4?.priority).toBe(0);
  await page.getByRole("link", { name: "first-priority", exact: true }).click();
  await page.getByRole("button", { name: "Change priority", exact: true }).click();
  await input.fill("-9");
  await page.getByRole("button", { name: "Confirm priority change", exact: true }).click();
  await expect(
    page
      .getByRole("term")
      .filter({ hasText: /^Priority$/u })
      .locator("..")
      .getByRole("definition"),
  ).toHaveText("-9");
  const awaitedResult5 = await app.monque.getJob(first._id);
  expect(awaitedResult5?.priority).toBe(-9);
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
    await page.goto(`${app.origin}/private/dashboard/jobs/${String(job._id)}`);
    await page.getByRole("button", { name: "Change priority", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Priority", exact: true }).fill("22");
    // Stop fresh reads until the stale confirmation reaches the authoritative server.
    const resumeReads: PromiseWithResolvers<void> = Promise.withResolvers();
    await page.route(`**/private/api/v1/jobs/${String(job._id)}`, async (route) => {
      if (route.request().method() === "GET") {
        await resumeReads.promise;
      }
      await route.continue();
    });
    try {
      if (change === "cancelled") {
        await app.monque.cancelJob(job._id.toHexString());
      } else if (change === "missing") {
        await app.monque.deleteJob(job._id.toHexString());
      } else {
        const awaitedResult6 = await context.cookies();
        const cookie = awaitedResult6.find((currentCookie1) => currentCookie1.name === "session");
        const session = app.sessions.get(cookie?.value ?? "");
        if (!session) {
          throw new Error("Missing operator session");
        }
        session.role = "viewer";
      }
      const response = page.waitForResponse(
        (currentResponse2) =>
          currentResponse2.request().method() === "POST" &&
          currentResponse2.url().endsWith(`/jobs/${String(job._id)}/actions/priority`),
      );
      await page.getByRole("button", { name: "Confirm priority change", exact: true }).click();
      const awaitedResult7 = await response;
      expect(awaitedResult7.status()).toBe(
        (() => {
          if (change === "cancelled") {
            return 409;
          }
          if (change === "missing") {
            return 404;
          }
          return 403;
        })(),
      );
    } finally {
      resumeReads.resolve();
    }
    await expect(
      page
        .getByText(
          (() => {
            if (change === "cancelled") {
              return "State conflict";
            }
            if (change === "missing") {
              return "Job not found";
            }
            return "Action unavailable";
          })(),
          { exact: true },
        )
        .first(),
    ).toBeVisible();
    await expect(page.getByText("Job priority changed", { exact: true })).not.toBeVisible();
    const current = await app.monque.getJob(job._id);
    if (change === "missing") {
      expect(current).toBeNull();
    } else {
      expect(current?.priority).toBe(4);
    }
    if (change === "denied") {
      await expect(
        page.getByRole("button", { name: "Change priority", exact: true }),
      ).toBeDisabled();
    }
  });
}
test("priority controls are unavailable for non-pending Jobs and read-only hosts", async ({
  page,
  app,
}) => {
  await forEachSequential(
    ["processing", "completed", "failed", "cancelled"] as const,
    async (status) => {
      const job = await app.seed({ name: `priority-${status}`, status });
      await page.goto(`${app.base}/dashboard/jobs/${String(job._id)}`);
      await expect(
        page.getByRole("button", { name: "Change priority", exact: true }),
      ).toBeDisabled();
    },
  );
  const pending = await app.seed();
  await page.goto(`${app.origin}/readonly/dashboard/jobs/${String(pending._id)}`);
  await expect(page.getByRole("button", { name: "Change priority", exact: true })).toBeDisabled();
});
