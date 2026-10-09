// @vitest-environment jsdom
import type { JobDto } from "@monque/management/contract";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { parseJobsRouteSearch } from "@/features/jobs/job-list-search";
import { createDashboardManagementApi } from "@/management-client";
import { DashboardProviders } from "@/providers";
import { createDashboardQueryClient } from "@/query-client";
import { getRouter } from "@/router";
import { parseDashboardRuntimeConfig } from "@/runtime-config";

const createJobDetail = (overrides: Partial<JobDto> = {}): JobDto => ({
  id: "job-123",
  name: "send-email",
  status: "pending",
  priority: 0,
  payload: {
    recipient: "person@example.test",
  },
  nextRunAt: "2026-06-03T12:00:00.000Z",
  lockedAt: null,
  claimedBy: null,
  lastHeartbeat: null,
  heartbeatInterval: undefined,
  failCount: 0,
  failureReason: null,
  repeatInterval: undefined,
  uniqueKey: "send-email:person@example.test",
  createdAt: "2026-06-03T11:45:00.000Z",
  updatedAt: "2026-06-03T11:55:00.000Z",
  ...overrides,
});
const renderJobDetailRoute = async (options: {
  readonly fetch: typeof fetch;
  readonly jobId: string;
  readonly queryClient?: ReturnType<typeof createDashboardQueryClient>;
}): Promise<ReturnType<typeof getRouter>> => {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: vi.fn<typeof Element.prototype.scrollTo>(),
  });
  window.history.pushState({}, "", `/jobs/${options.jobId}`);
  const runtimeConfig = parseDashboardRuntimeConfig({
    apiBaseUrl: "/",
    basePath: "/",
    pollingIntervalMs: 10_000,
  });
  const managementApi = createDashboardManagementApi({
    apiBaseUrl: runtimeConfig.apiBaseUrl,
    fetch: options.fetch,
    origin: window.location.origin,
  });
  const queryClient = options.queryClient ?? createDashboardQueryClient();
  const router = getRouter({ managementApi, queryClient, runtimeConfig });
  await router.load();
  render(<DashboardProviders queryClient={queryClient} router={router} />);
  return router;
};
const createJsonResponse = (body: Parameters<typeof Response.json>[0], status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
const createJobDetailFetch =
  (job: JobDto): typeof fetch =>
  async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/v1/capabilities") {
      return await Promise.resolve(
        createJsonResponse({
          readOnly: false,
          actions: {
            read: true,
            cancel: true,
            cancelBulk: true,
            retry: true,
            retryBulk: true,
            reschedule: true,
            delete: true,
            deleteBulk: true,
          },
        }),
      );
    }
    if (request.method === "GET" && url.pathname === `/api/v1/jobs/${job.id}`) {
      return await Promise.resolve(createJsonResponse(job));
    }
    return await Promise.resolve(
      createJsonResponse(
        {
          code: "NOT_FOUND",
          data: {
            error: "Route not found",
          },
          defined: false,
          message: "Route not found",
          status: 404,
        },
        404,
      ),
    );
  };
const installClipboardSpy = () => {
  const clipboardWriteText = vi.fn<(text: string) => Promise<void>>(async () => {
    await Promise.resolve();
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: clipboardWriteText,
    },
  });
  return clipboardWriteText;
};
const createOrpcErrorResponse = (code: string, status: number, message: string): Response =>
  createJsonResponse(
    {
      code,
      data: {
        error: message,
      },
      defined: false,
      message,
      status,
    },
    status,
  );
const createStaticFetch =
  (response: Response): typeof fetch =>
  async () =>
    await Promise.resolve(response.clone());
interface CreateJobDetailActionFetchResult {
  readonly deleteCount: number;
  readonly detailRequestCount: number;
  readonly fetch: typeof fetch;
}
const createJobDetailActionFetch = (job: JobDto): CreateJobDetailActionFetchResult => {
  let deleted = false;
  let deleteCount = 0;
  let detailRequestCount = 0;
  return {
    get deleteCount() {
      return deleteCount;
    },
    get detailRequestCount() {
      return detailRequestCount;
    },
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/v1/capabilities") {
        return await Promise.resolve(
          createJsonResponse({
            readOnly: false,
            actions: {
              read: true,
              cancel: true,
              cancelBulk: true,
              retry: true,
              retryBulk: true,
              reschedule: true,
              delete: true,
              deleteBulk: true,
            },
          }),
        );
      }
      if (request.method === "GET" && url.pathname === `/api/v1/jobs/${job.id}`) {
        detailRequestCount += 1;
        if (deleted) {
          return await Promise.resolve(createOrpcErrorResponse("NOT_FOUND", 404, "Job not found"));
        }
        return await Promise.resolve(createJsonResponse(job));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/jobs") {
        return await Promise.resolve(
          createJsonResponse({
            jobs: [],
            hasNextPage: false,
            hasPreviousPage: false,
            cursor: null,
          }),
        );
      }
      if (request.method === "DELETE" && url.pathname === `/api/v1/jobs/${job.id}`) {
        deleteCount += 1;
        deleted = true;
        return await Promise.resolve(createJsonResponse({ deleted: true }));
      }
      return await Promise.resolve(createOrpcErrorResponse("NOT_FOUND", 404, "Route not found"));
    },
  };
};
describe("Job detail route", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the lease deadline only when the job uses renewable leases", async () => {
    const job = createJobDetail({ leaseExpiresAt: "2026-09-27T16:00:00.000Z" });
    await renderJobDetailRoute({ fetch: createJobDetailFetch(job), jobId: job.id });
    await expect(screen.findByText("Lease expires")).resolves.toBeInstanceOf(HTMLElement);
  });

  it.each(["Europe/Berlin", undefined])(
    "shows the recurring schedule timezone %s separately from display time",
    async (timezone) => {
      const job = createJobDetail({ repeatInterval: "0 9 * * *", timezone });
      await renderJobDetailRoute({ fetch: createJobDetailFetch(job), jobId: job.id });
      const label = await screen.findByText("Schedule timezone");
      expect(label.parentElement?.textContent).toBe(
        `Schedule timezone${timezone ?? "Server local timezone"}`,
      );
      expect(screen.getByText(/^Local time:/u)).toBeInstanceOf(HTMLElement);
    },
  );

  it("does not show a schedule timezone for a one-time job", async () => {
    const job = createJobDetail();
    await renderJobDetailRoute({ fetch: createJobDetailFetch(job), jobId: job.id });
    await screen.findByRole("heading", { name: job.name });
    expect(screen.queryByText("Schedule timezone")).toBeNull();
    expect(screen.queryByText("Lease expires")).toBeNull();
  });

  it("shows job detail metadata, payload, and copy controls", async () => {
    const payload = {
      attempt: 3,
      nested: {
        token: "visible-management-token",
      },
      recipient: "person@example.test",
    };
    const job = createJobDetail({
      failCount: 2,
      failureReason: "SMTP rejected recipient domain.",
      payload,
      repeatInterval: "*/15 * * * *",
      status: "failed",
    });
    const clipboardWriteText = installClipboardSpy();
    await renderJobDetailRoute({
      fetch: createJobDetailFetch(job),
      jobId: job.id,
    });
    await expect(screen.findByRole("heading", { name: job.name })).resolves.toBeInstanceOf(
      HTMLElement,
    );
    expect({
      failureVisible: screen.getByText("SMTP rejected recipient domain.") instanceof HTMLElement,
      idVisible: screen.getByText(job.id) instanceof HTMLElement,
      payloadVisible: screen.getByText("Payload") instanceof HTMLElement,
    }).toStrictEqual({ failureVisible: true, idVisible: true, payloadVisible: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy job ID" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy payload" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy shareable URL" }));
    await waitFor(() => {
      expect(clipboardWriteText.mock.calls.map(([text]) => text)).toStrictEqual([
        job.id,
        JSON.stringify(payload, null, 2),
        window.location.href,
      ]);
    });
    expect(screen.getByRole("button", { name: "Copy job ID" })).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole("button", { name: "Copy shareable URL" })).toBeInstanceOf(HTMLElement);
  });

  it("shows an explicit empty payload state", async () => {
    const job = createJobDetail({
      id: "job-empty-payload",
      payload: {},
    });
    await renderJobDetailRoute({
      fetch: createJobDetailFetch(job),
      jobId: job.id,
    });
    await expect(screen.findByRole("heading", { name: job.name })).resolves.toBeInstanceOf(
      HTMLElement,
    );
    expect(screen.getByText("This job has no payload.")).toBeInstanceOf(HTMLElement);
  });

  it.each(["nested", "array", "object"])(
    "opens %s payloads on demand while copying their complete contents",
    async (errorFormat) => {
      const records = Array.from({ length: 200 }, (_, id) => ({ name: `payload-record-${id}` }));
      const payload = (() => {
        if (errorFormat === "nested") {
          return { records };
        }
        if (errorFormat === "array") {
          return records;
        }
        return Object.fromEntries(records.map((record, index) => [String(index), record]));
      })();
      const job = createJobDetail({ payload });
      const clipboardWriteText = installClipboardSpy();
      await renderJobDetailRoute({ fetch: createJobDetailFetch(job), jobId: job.id });
      await screen.findByRole("heading", { name: job.name });
      expect(screen.queryByText(/payload-record-199/u)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Copy payload" }));
      await waitFor(() => {
        expect(clipboardWriteText).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
      });
      fireEvent.click(screen.getByRole("button", { name: "Expand JSON value" }));
      // Avoid computing visibility and accessible names for every record in the expanded tree.
      const expansionButtons = screen.getAllByLabelText("Expand JSON value", {
        selector: "button",
      });
      const lastRecord = expansionButtons.at(-1);
      if (!lastRecord) {
        throw new Error("Expected the final payload record to be expandable");
      }
      fireEvent.click(lastRecord);
      expect(screen.getByText(/payload-record-199/u)).toBeInstanceOf(HTMLElement);
    },
  );

  it.each([
    ["new pending job", "pending", 0, undefined, 0],
    ["pending retry after backoff", "pending", 2, undefined, 2],
    ["failed job", "failed", 2, undefined, 2],
    ["processing retry", "processing", 2, undefined, 3],
    ["completed retry", "completed", 2, undefined, 3],
    ["cancelled retry", "cancelled", 2, undefined, 2],
    ["recurring job after its successful run", "pending", 0, "*/15 * * * *", 0],
  ] satisfies readonly (readonly [string, JobDto["status"], number, string | undefined, number])[])(
    "shows attempts since reset for a %s",
    async (_description, status, failCount, repeatInterval, attempts) => {
      const job = createJobDetail({ status, failCount, repeatInterval });
      await renderJobDetailRoute({ fetch: createJobDetailFetch(job), jobId: job.id });
      const label = await screen.findByText("Attempts since reset");
      expect(label.parentElement?.textContent).toBe(`Attempts since reset${attempts}`);
    },
  );

  it.each([1, 2])(
    "allows manual retry after %i failed attempts, including a non-retryable failure",
    async (failCount) => {
      let job = createJobDetail({
        status: "failed",
        failCount,
        failureReason: "Account no longer exists",
      });
      await renderJobDetailRoute({
        jobId: job.id,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (
            request.method === "POST" &&
            new URL(request.url).pathname.endsWith("/actions/retry")
          ) {
            job = { ...job, status: "pending", failCount: 0 };
            return createJsonResponse(job);
          }
          return await createJobDetailFetch(job)(request);
        },
      });
      const label = await screen.findByText("Attempts since reset");
      expect(label.parentElement?.textContent).toBe(`Attempts since reset${failCount}`);
      expect(screen.getByText("Account no longer exists")).toBeInstanceOf(HTMLElement);
      fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
      await waitFor(() => {
        expect(screen.getByText("Attempts since reset").parentElement?.textContent).toBe(
          "Attempts since reset0",
        );
      });
    },
  );

  it.each(["Delete job", "Reschedule"])(
    "clears an open %s confirmation when returning to a cached job",
    async (action) => {
      const first = createJobDetail({ id: "first-job", name: "first-job" });
      const second = createJobDetail({ id: "second-job", name: "second-job" });
      const router = await renderJobDetailRoute({
        jobId: first.id,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          const job = new URL(request.url).pathname.endsWith(second.id) ? second : first;
          return await createJobDetailFetch(job)(request);
        },
      });
      await expect(screen.findByRole("heading", { name: first.name })).resolves.toBeInstanceOf(
        HTMLElement,
      );
      await act(async () => {
        await router.navigate({
          to: "/jobs/$jobId",
          params: { jobId: second.id },
          search: parseJobsRouteSearch({}),
        });
      });
      await expect(screen.findByRole("heading", { name: second.name })).resolves.toBeInstanceOf(
        HTMLElement,
      );
      fireEvent.click(screen.getByRole("button", { name: action }));
      await expect(screen.findByRole("dialog")).resolves.toBeInstanceOf(HTMLElement);
      await act(async () => {
        await Promise.resolve();
        router.history.back();
      });
      await expect(
        screen.findByRole("heading", { name: first.name, hidden: true }),
      ).resolves.toBeInstanceOf(HTMLElement);
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    },
  );

  it.each(["Delete job", "Reschedule"])(
    "keeps an open %s confirmation available when a background read fails",
    async (action) => {
      const job = createJobDetail();
      const queryClient = createDashboardQueryClient();
      let failReads = false;
      await renderJobDetailRoute({
        jobId: job.id,
        queryClient,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (failReads && new URL(request.url).pathname === `/api/v1/jobs/${job.id}`) {
            throw new TypeError("Failed to fetch");
          }
          return await createJobDetailFetch(job)(request);
        },
      });
      await screen.findByRole("heading", { name: job.name });
      fireEvent.click(screen.getByRole("button", { name: action }));
      await screen.findByRole("dialog");
      failReads = true;
      await act(async () => {
        await queryClient.refetchQueries();
      });
      await screen.findByText("Failed to fetch");
      expect(
        screen.getByRole("button", {
          name: action === "Delete job" ? "Confirm delete job" : "Confirm reschedule job",
        }),
      ).toBeInstanceOf(HTMLElement);
    },
  );

  it.each([
    ["UNAUTHORIZED", 401, "Sign in required"],
    ["FORBIDDEN", 403, "Job detail is forbidden"],
    ["NOT_FOUND", 404, "Job not found"],
  ] satisfies readonly (readonly [string, number, string])[])(
    "hides the cached job and confirmation after a %s refresh",
    async (code, status, heading) => {
      const job = createJobDetail();
      const queryClient = createDashboardQueryClient();
      let failReads = false;
      await renderJobDetailRoute({
        jobId: job.id,
        queryClient,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (failReads && new URL(request.url).pathname === `/api/v1/jobs/${job.id}`) {
            return createOrpcErrorResponse(code, status, "Host rejected the request.");
          }
          return await createJobDetailFetch(job)(request);
        },
      });
      await screen.findByRole("heading", { name: job.name });
      fireEvent.click(screen.getByRole("button", { name: "Delete job" }));
      await screen.findByRole("dialog");
      failReads = true;
      await act(async () => {
        await queryClient.refetchQueries();
      });
      await screen.findByRole("heading", { name: heading });
      expect(screen.queryByRole("heading", { name: job.name })).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it.each([
    [
      "unauthorized",
      createOrpcErrorResponse("UNAUTHORIZED", 401, "Sign in to inspect this Job detail."),
      "Sign in required",
    ],
    [
      "forbidden",
      createOrpcErrorResponse(
        "FORBIDDEN",
        403,
        "Your current Management session cannot read this Job detail.",
      ),
      "Job detail is forbidden",
    ],
    ["not-found", createOrpcErrorResponse("NOT_FOUND", 404, "Job not found"), "Job not found"],
    [
      "error",
      createOrpcErrorResponse(
        "INTERNAL_SERVER_ERROR",
        500,
        "The Management API could not load this Job detail.",
      ),
      "Job detail could not be loaded",
    ],
  ] satisfies readonly (readonly [string, Response, string])[])(
    "maps typed %s states for operators",
    async (_name, response, heading) => {
      await renderJobDetailRoute({
        fetch: createStaticFetch(response),
        jobId: "job-error-state",
      });
      await expect(screen.findByRole("heading", { name: heading })).resolves.toBeInstanceOf(
        HTMLElement,
      );
    },
  );

  it("returns to jobs after deletion without refetching the deleted detail", async () => {
    const job = createJobDetail({
      id: "job-delete-me",
    });
    const fetchState = createJobDetailActionFetch(job);
    await renderJobDetailRoute({
      fetch: fetchState.fetch,
      jobId: job.id,
    });
    await expect(screen.findByRole("heading", { name: job.name })).resolves.toBeInstanceOf(
      HTMLElement,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete job" }));
    expect(fetchState.deleteCount).toBe(0);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delete job" }));
    await expect(screen.findByRole("heading", { name: "No jobs found" })).resolves.toBeInstanceOf(
      HTMLElement,
    );
    expect(fetchState.deleteCount).toBe(1);
    expect(fetchState.detailRequestCount).toBe(1);
  });
});
