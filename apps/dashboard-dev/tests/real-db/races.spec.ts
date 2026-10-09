import { forEachSequential } from "../setup/sequential.js";
import { expect, test } from "./fixture.js";

for (const action of ["Delete job", "Reschedule"] as const) {
  test(`an open ${action} confirmation belongs only to its original job`, async ({ page, app }) => {
    const first = await app.seed({ name: "first-job" });
    const second = await app.seed({ name: "second-job" });
    await page.goto(`${app.base}/dashboard/jobs/${String(first._id)}`);
    await expect(page.getByRole("heading", { name: "first-job", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "← Back to jobs", exact: true }).click();
    await page.getByRole("link", { name: "second-job", exact: true }).click();
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.evaluate(() => {
      window.history.go(-2);
    });
    await expect(page.getByRole("heading", { name: "first-job", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await app.jobs.findOne({ _id: first._id })).not.toBeNull();
    expect(await app.jobs.findOne({ _id: second._id })).not.toBeNull();
    await page.getByRole("button", { name: "Delete job", exact: true }).click();
    await page.getByRole("button", { name: "Confirm delete job", exact: true }).click();
    await expect(page.getByText("Job deleted", { exact: true })).toBeVisible();
    expect(await app.jobs.findOne({ _id: first._id })).toBeNull();
    expect(await app.jobs.findOne({ _id: second._id })).not.toBeNull();
  });
}
test("a delayed deletion does not pull the operator away from another job", async ({
  page,
  app,
}) => {
  const first = await app.seed({ name: "first-job" });
  const second = await app.seed({ name: "second-job" });
  const received: PromiseWithResolvers<void> = Promise.withResolvers();
  const release: PromiseWithResolvers<void> = Promise.withResolvers();
  await page.route(`**/api/v1/jobs/${String(first._id)}`, async (route) => {
    if (route.request().method() === "DELETE") {
      received.resolve();
      await release.promise;
    }
    await route.continue();
  });
  await page.goto(`${app.base}/dashboard/jobs/${String(first._id)}`);
  await page.getByRole("button", { name: "Delete job", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete job", exact: true }).click();
  await received.promise;
  try {
    await page.getByRole("link", { name: "← Back to jobs", exact: true }).click();
    await page.getByRole("link", { name: "second-job", exact: true }).click();
    await expect(page.getByRole("heading", { name: "second-job", exact: true })).toBeVisible();
  } finally {
    release.resolve();
  }
  await expect(page.getByText("Job deleted", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/jobs/${String(second._id)}`, "u"));
  expect(await app.jobs.findOne({ _id: first._id })).toBeNull();
  expect(await app.jobs.findOne({ _id: second._id })).not.toBeNull();
});
for (const outcome of ["success", "failure"] as const) {
  test(`a delayed bulk ${outcome} preserves newer selections without reselecting hidden jobs`, async ({
    page,
    app,
  }) => {
    const first = await app.seed({ name: "first-job" });
    const second = await app.seed({ name: "second-job" });
    const received: PromiseWithResolvers<void> = Promise.withResolvers();
    const release: PromiseWithResolvers<void> = Promise.withResolvers();
    await page.route(`**/api/v1/jobs/${String(first._id)}`, async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.continue();
        return;
      }
      received.resolve();
      await release.promise;
      await (outcome === "failure" ? route.abort("failed") : route.continue());
    });
    await page.goto(`${app.base}/dashboard/jobs`);
    await page
      .getByRole("checkbox", { name: `Select job row first-job ${String(first._id)}` })
      .check();
    await page.getByRole("button", { name: "Delete selected jobs", exact: true }).click();
    await page.getByRole("button", { name: "Confirm delete selected jobs", exact: true }).click();
    await received.promise;
    try {
      await page.getByLabel("Job name", { exact: true }).fill("second-job");
      await expect(page.locator("tbody tr")).toHaveCount(1);
      await page
        .getByRole("checkbox", { name: `Select job row second-job ${String(second._id)}` })
        .check();
    } finally {
      release.resolve();
    }
    await expect(
      page.getByText(outcome === "failure" ? "Action failed" : "Job deleted", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: `Select job row second-job ${String(second._id)}` }),
    ).toBeChecked();
    await page.getByLabel("Job name", { exact: true }).fill("");
    await expect(page.locator("tbody tr")).toHaveCount(outcome === "failure" ? 2 : 1);
    if (outcome === "failure") {
      await expect(
        page.getByRole("checkbox", { name: `Select job row first-job ${String(first._id)}` }),
      ).not.toBeChecked();
    }
    expect(await app.jobs.countDocuments()).toBe(outcome === "failure" ? 2 : 1);
  });
}
for (const view of ["detail", "list"] as const) {
  test(`offline ${view} confirmation fails visibly and does not execute later on reconnect`, async ({
    page,
    app,
    context,
  }) => {
    const job = await app.seed();
    await page.goto(`${app.base}/dashboard/jobs${view === "detail" ? `/${String(job._id)}` : ""}`);
    const openDelete = async () => {
      if (view === "detail") {
        await page.getByRole("button", { name: "Delete job", exact: true }).click();
      } else {
        await page.getByRole("button", { name: `Actions for ${String(job._id)}` }).click();
        await page.getByRole("menuitem", { name: "Delete job", exact: true }).click();
      }
    };
    await openDelete();
    let failedRead: Promise<unknown> | undefined;
    const releaseRead: PromiseWithResolvers<void> = Promise.withResolvers();
    if (view === "detail") {
      const receivedRead: PromiseWithResolvers<void> = Promise.withResolvers();
      await page.route(`**/api/v1/jobs/${String(job._id)}`, async (route) => {
        if (route.request().method() === "GET") {
          receivedRead.resolve();
          await releaseRead.promise;
        }
        await route.continue();
      });
      await receivedRead.promise;
      failedRead = page.waitForEvent(
        "requestfailed",
        (request) =>
          request.method() === "GET" &&
          new URL(request.url()).pathname.endsWith(`/api/v1/jobs/${String(job._id)}`),
      );
    }
    await context.setOffline(true);
    try {
      // An in-flight poll must fail before confirming, matching the CI race.
      releaseRead.resolve();
      await failedRead;
      await page.getByRole("button", { name: "Confirm delete job", exact: true }).click();
      await expect(page.getByText("Action failed", { exact: true })).toBeVisible();
    } finally {
      releaseRead.resolve();
      await context.setOffline(false);
    }
    await expect(
      page.getByRole("button", {
        name: view === "detail" ? "Delete job" : `Actions for ${String(job._id)}`,
        exact: true,
      }),
    ).toBeEnabled();
    await expect
      .poll(async () => {
        const awaitedResult1 = await app.jobs.findOne({ _id: job._id });
        return awaitedResult1?.status;
      })
      .toBe("pending");
    await openDelete();
    await page.getByRole("button", { name: "Confirm delete job", exact: true }).click();
    await expect(page.getByText("Job deleted", { exact: true })).toBeVisible();
    expect(await app.jobs.findOne({ _id: job._id })).toBeNull();
  });
}
test("expiry during confirmation is rejected by the host without deleting the job", async ({
  page,
  app,
  context,
}) => {
  const job = await app.seed();
  const awaitedResult3 = await context.request.post(`${app.origin}/auth/login`, {
    data: { username: "operator", password: "fixture-password" },
  });
  expect(awaitedResult3.status()).toBe(204);
  await page.goto(`${app.origin}/private/dashboard/jobs/${String(job._id)}`);
  await page.getByRole("button", { name: "Delete job", exact: true }).click();
  const resumeReads: PromiseWithResolvers<void> = Promise.withResolvers();
  await page.route(`**/private/api/v1/jobs/${String(job._id)}`, async (route) => {
    if (route.request().method() === "GET") {
      await resumeReads.promise;
    }
    await route.continue();
  });
  try {
    const awaitedResult2 = await context.cookies();
    const cookie = awaitedResult2.find((currentCookie1) => currentCookie1.name === "session");
    const session = app.sessions.get(cookie?.value ?? "");
    if (!session) {
      throw new Error("Expected a logged-in session");
    }
    session.expiresAt = Date.now() - 1;
    const rejected = page.waitForResponse(
      (response) => response.request().method() === "DELETE" && response.status() === 401,
    );
    await page.getByRole("button", { name: "Confirm delete job", exact: true }).click();
    await rejected;
  } finally {
    resumeReads.resolve();
  }
  await expect(page.getByRole("heading", { name: "Sign in required", exact: true })).toBeVisible();
  expect(await app.jobs.findOne({ _id: job._id })).not.toBeNull();
});
test("repeated cancel and retry actions remain usable while the list keeps polling", async ({
  page,
  app,
}) => {
  const job = await app.seed();
  let reads = 0;
  page.on("response", (response) => {
    if (
      response.request().method() === "GET" &&
      new URL(response.url()).pathname.endsWith("/api/v1/jobs")
    ) {
      reads += 1;
    }
  });
  await page.goto(`${app.base}/dashboard/jobs`);
  const row = page
    .locator("tbody tr")
    .filter({ has: page.getByRole("button", { name: `Actions for ${String(job._id)}` }) });
  await forEachSequential(
    Array.from({ length: 3 }, (_, cycle) => cycle),
    async () => {
      await forEachSequential(
        [
          ["Cancel job", "Cancelled", "cancelled"],
          ["Retry job", "Pending", "pending"],
        ] as const,
        async ([action, label, status]) => {
          await row.getByRole("button", { name: `Actions for ${String(job._id)}` }).click();
          await page.getByRole("menuitem", { name: action, exact: true }).click();
          await expect(row.getByText(label, { exact: true })).toBeVisible();
          await expect(
            row.getByRole("button", { name: `Actions for ${String(job._id)}` }),
          ).toBeEnabled();
          const awaitedResult4 = await app.jobs.findOne({ _id: job._id });
          expect(awaitedResult4?.status).toBe(status);
        },
      );
    },
  );
  const completedReads = reads;
  await expect.poll(() => reads).toBeGreaterThan(completedReads);
  await expect(page.getByText("Action failed", { exact: true })).not.toBeVisible();
});
