// @vitest-environment jsdom
import { createMockManagementFetch } from "@dashboard-dev/mock/management-server";
import type { CapabilitiesDto, JobDto } from "@monque/management/contract";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { parseJobsRouteSearch } from "@/features/jobs/job-list-search";
import { isString, isFunction } from "@/lib/type-guards";

import { createDashboardHarness } from "../setup/dashboard-harness.js";
import { forEachSequential } from "../setup/sequential.js";

type HarnessOptions = {
  -readonly [Key in keyof NonNullable<Parameters<typeof createDashboardHarness>[1]>]: NonNullable<
    Parameters<typeof createDashboardHarness>[1]
  >[Key];
};
const renderJobsRoute = async ({
  fetch: fetchImplementation,
  initialEntry,
  pollingIntervalMs,
}: {
  readonly fetch: typeof globalThis.fetch;
  readonly initialEntry: string;
  readonly pollingIntervalMs?: number;
}) => {
  const harnessOptions: HarnessOptions = { fetch: fetchImplementation, history: "memory" };
  if (pollingIntervalMs !== undefined) {
    harnessOptions.pollingIntervalMs = pollingIntervalMs;
  }
  const dashboard = createDashboardHarness(initialEntry, harnessOptions);
  await dashboard.router.load();
  dashboard.render();
  return { router: dashboard.router };
};
const getFirstElement = <TElement,>(elements: readonly TElement[]): TElement => {
  const [firstElement] = elements;
  if (firstElement === undefined) {
    throw new Error("Expected at least one matching element.");
  }
  return firstElement;
};
const createCapabilities = (overrides: Partial<CapabilitiesDto> = {}): CapabilitiesDto => ({
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
    ...overrides.actions,
  },
  ...overrides,
});
const createJsonResponse = (body: Parameters<typeof Response.json>[0], status = 200): Response =>
  Response.json(body, {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
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
interface CreateJobsActionFetchResult {
  readonly deletedJobIds: string[];
  readonly fetch: typeof fetch;
  readonly listRequestCount: number;
}
const createJobsActionFetch = (options: {
  readonly capabilities?: CapabilitiesDto;
  readonly jobs: readonly JobDto[];
}): CreateJobsActionFetchResult => {
  const capabilities = options.capabilities ?? createCapabilities();
  const jobs = [...options.jobs];
  const deletedJobIds: string[] = [];
  let listRequestCount = 0;
  return {
    deletedJobIds,
    get listRequestCount() {
      return listRequestCount;
    },
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const url = new URL(request.url, "https://dashboard.test");
      if (request.method === "GET" && url.pathname === "/api/v1/capabilities") {
        return await Promise.resolve(createJsonResponse(capabilities));
      }
      if (request.method === "GET" && url.pathname === "/api/v1/jobs") {
        listRequestCount += 1;
        return await Promise.resolve(
          createJsonResponse({
            jobs: [...jobs],
            cursor: null,
            hasNextPage: false,
            hasPreviousPage: false,
          }),
        );
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/api/v1/jobs/")) {
        const jobId = url.pathname.split("/").at(-1);
        if (jobId === undefined || jobId === null || jobId === "") {
          return await Promise.resolve(createJsonResponse({ error: "Job not found" }, 404));
        }
        const jobIndex = jobs.findIndex((job) => job.id === jobId);
        if (jobIndex === -1) {
          return await Promise.resolve(createOrpcErrorResponse("NOT_FOUND", 404, "Job not found"));
        }
        jobs.splice(jobIndex, 1);
        deletedJobIds.push(jobId);
        return await Promise.resolve(createJsonResponse({ deleted: true }));
      }
      return await Promise.resolve(createOrpcErrorResponse("NOT_FOUND", 404, "Route not found"));
    },
  };
};
const createListJob = (overrides: Partial<JobDto> = {}): JobDto => ({
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
const createForbiddenFetch = (): typeof fetch => async () =>
  await Promise.resolve(
    Response.json(
      { error: "Forbidden by test fixture." },
      {
        status: 403,
        headers: {
          "content-type": "application/json",
        },
      },
    ),
  );
describe("Jobs route", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("sorts on mobile and unmounts columns hidden by responsive breakpoints", async () => {
    const mediaDefaults = window.matchMedia("");
    const listeners = new Set<() => void>();
    let compact = true;
    const media = vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      Object.assign(mediaDefaults, {
        media: query,
        matches: compact,
        addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
          if (isFunction(listener)) {
            listeners.add(() => {
              listener(new Event("change"));
            });
          }
        },
        removeEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
          void listener;
        },
      }),
    );
    try {
      // One row exercises responsive columns and sort controls without a large table render.
      const fetchSpy = vi.fn<typeof fetch>(
        createJobsActionFetch({ jobs: [createListJob({ name: "dispatch-webhook" })] }).fetch,
      );
      const { router } = await renderJobsRoute({ fetch: fetchSpy, initialEntry: "/jobs" });
      await screen.findAllByRole("link", { name: /dispatch-webhook/u });
      expect({
        sortBy: screen
          .getByRole("combobox", { name: "Sort by" })
          .textContent?.includes("Created time"),
        sortDirection: screen
          .getByRole("combobox", { name: "Sort direction" })
          .textContent?.includes("Descending"),
        pageSize: screen
          .getByRole("combobox", { name: "Page size" })
          .textContent?.includes("50 rows"),
        hiddenHeaders: screen.queryByRole("columnheader", {
          name: /Created time|Updated time|Next run|Identifier/u,
        }),
        dates: document.querySelectorAll("tbody time").length,
      }).toStrictEqual({
        sortBy: true,
        sortDirection: true,
        pageSize: true,
        hiddenHeaders: null,
        dates: 0,
      });
      fireEvent.click(screen.getByRole("combobox", { name: "Sort by" }));
      const sortOption = await screen.findByRole("option", { name: "Updated time" });
      fireEvent.pointerDown(sortOption, { pointerType: "mouse" });
      fireEvent.click(sortOption);
      await waitFor(() => {
        expect({
          sortBy: router.state.location.search.sortBy,
          label: screen
            .getByRole("combobox", { name: "Sort by" })
            .textContent?.includes("Updated time"),
        }).toStrictEqual({ sortBy: "updatedAt", label: true });
      });
      fireEvent.click(screen.getByRole("combobox", { name: "Sort direction" }));
      const directionOption = await screen.findByRole("option", { name: "Ascending" });
      fireEvent.pointerDown(directionOption, { pointerType: "mouse" });
      fireEvent.click(directionOption);
      await waitFor(() => {
        expect({
          sortBy: router.state.location.search.sortBy,
          sortDirection: router.state.location.search.sortDirection,
          label: screen
            .getByRole("combobox", { name: "Sort direction" })
            .textContent?.includes("Ascending"),
          requested: fetchSpy.mock.calls.some(([input]) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            return (
              url.searchParams.get("sortBy") === "updatedAt" &&
              url.searchParams.get("sortDirection") === "asc"
            );
          }),
        }).toStrictEqual({
          sortBy: "updatedAt",
          sortDirection: "asc",
          label: true,
          requested: true,
        });
      });
      await act(async () => {
        await router.navigate({
          to: "/jobs",
          search: (current) => ({ ...parseJobsRouteSearch(current), sortDirection: "desc" }),
        });
      });
      await act(async () => {
        await Promise.resolve();
        router.history.back();
      });
      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "Sort direction" }).textContent).toContain(
          "Ascending",
        );
      });
      act(() => {
        compact = false;
        for (const listener of listeners) {
          listener();
        }
      });
      expect({
        headerVisible:
          screen.getByRole("columnheader", { name: "Created time" }) instanceof HTMLElement,
        datesVisible: document.querySelectorAll("tbody time").length > 0,
      }).toStrictEqual({ headerVisible: true, datesVisible: true });
    } finally {
      media.mockRestore();
    }
  });

  it("restores URL-backed filters and sorting into the Jobs table query", async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      createMockManagementFetch({ scenarioId: "large-dataset" }),
    );
    await renderJobsRoute({
      fetch: fetchSpy,
      initialEntry:
        "/jobs?name=dispatch-webhook&status=failed&sortBy=updatedAt&sortDirection=asc&limit=25",
    });
    await screen.findByRole("heading", { name: "Jobs" });
    await waitFor(() => {
      expect(fetchSpy).not.toHaveBeenCalledTimes(0);
    });
    expect(screen.getByLabelText<HTMLInputElement>("Job name").value).toBe("dispatch-webhook");
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    expect(screen.getByText("Updated time")).toBeInstanceOf(HTMLElement);
    expect(
      fetchSpy.mock.calls.some(([request]) => {
        const url = new URL(
          request instanceof Request ? request.url : String(request),
          "https://dashboard.test",
        );
        return (
          url.pathname === "/api/v1/jobs" &&
          url.searchParams.get("name") === "dispatch-webhook" &&
          url.searchParams.get("status") === "failed" &&
          url.searchParams.get("sortBy") === "updatedAt" &&
          url.searchParams.get("sortDirection") === "asc" &&
          url.searchParams.get("limit") === "25"
        );
      }),
    ).toBe(true);
  });

  it.each(["/jobs", "/jobs/job-123"])(
    "refreshes granted permissions without leaving %s",
    async (initialEntry) => {
      const job = createListJob();
      const state = createJobsActionFetch({ jobs: [job] });
      let capabilitiesRequests = 0;
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path === "/api/v1/capabilities") {
          capabilitiesRequests += 1;
          const capabilities = createCapabilities();
          return Response.json({
            ...capabilities,
            actions: { ...capabilities.actions, cancel: capabilitiesRequests > 1 },
          });
        }
        if (path === `/api/v1/jobs/${job.id}`) {
          return Response.json(job);
        }
        return await state.fetch(request);
      };
      await renderJobsRoute({ fetch, initialEntry, pollingIntervalMs: 100 });
      const isList = initialEntry === "/jobs";
      if (isList) {
        fireEvent.click(await screen.findByRole("button", { name: `Actions for ${job.id}` }));
      }
      const action = await screen.findByRole(isList ? "menuitem" : "button", {
        name: isList ? "Cancel job" : "Cancel",
      });
      expect(
        action.hasAttribute("disabled") || action.getAttribute("aria-disabled") === "true",
      ).toBe(true);
      await waitFor(
        () => {
          expect(capabilitiesRequests).toBeGreaterThan(1);
          expect(
            action.hasAttribute("disabled") || action.getAttribute("aria-disabled") === "true",
          ).toBe(false);
        },
        { timeout: 2000 },
      );
    },
  );

  it("disables cached detail actions when the permission refresh is denied", async () => {
    const job = createListJob();
    let capabilitiesRequests = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === "/api/v1/capabilities") {
        capabilitiesRequests += 1;
        return await Promise.resolve(
          capabilitiesRequests === 1
            ? Response.json(createCapabilities())
            : Response.json({ error: "Access revoked" }, { status: 403 }),
        );
      }
      return await Promise.resolve(Response.json(job));
    };
    await renderJobsRoute({ fetch, initialEntry: `/jobs/${job.id}`, pollingIntervalMs: 100 });
    const action = await screen.findByRole("button", { name: "Cancel" });
    await waitFor(() => {
      expect(action.hasAttribute("disabled")).toBe(false);
    });
    await waitFor(
      () => {
        expect(capabilitiesRequests).toBe(2);
        expect(action.hasAttribute("disabled")).toBe(true);
      },
      { timeout: 2000 },
    );
  });

  it("refreshes permissions manually when automatic polling is disabled", async () => {
    const capabilities = createCapabilities();
    capabilities.actions.cancel = false;
    const job = createListJob();
    const state = createJobsActionFetch({ jobs: [job], capabilities });
    await renderJobsRoute({ fetch: state.fetch, initialEntry: "/jobs" });
    await screen.findByRole("button", { name: `Actions for ${job.id}` });
    capabilities.actions.cancel = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(state.listRequestCount).toBe(2);
    });
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${job.id}` }));
    await waitFor(() => {
      expect(
        screen.getByRole("menuitem", { name: "Cancel job" }).getAttribute("aria-disabled"),
      ).not.toBe("true");
    });
  });

  it("debounces name requests while immediately showing the typed value", async () => {
    const fetchSpy = vi.fn<typeof fetch>(
      createMockManagementFetch({ scenarioId: "large-dataset" }),
    );
    await renderJobsRoute({ fetch: fetchSpy, initialEntry: "/jobs?limit=10" });
    const input = await screen.findByLabelText<HTMLInputElement>("Job name");
    fetchSpy.mockClear();
    vi.useFakeTimers({ shouldClearNativeTimers: true });
    await forEachSequential(["s", "send", "send-email"], async (value) => {
      await act(async () => {
        await Promise.resolve();
        fireEvent.change(input, { target: { value } });
      });
      expect(input.value).toBe(value);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(40);
      });
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const names = fetchSpy.mock.calls.map(([request]) =>
      new URL(request instanceof Request ? request.url : String(request)).searchParams.get("name"),
    );
    expect(names).toStrictEqual(["send-email"]);
  });

  it("keeps the pending name when another filter triggers a loading state", async () => {
    const { router } = await renderJobsRoute({
      fetch: createMockManagementFetch({ scenarioId: "large-dataset" }),
      initialEntry: "/jobs?limit=10",
    });
    const input = await screen.findByLabelText<HTMLInputElement>("Job name");
    vi.useFakeTimers({ shouldClearNativeTimers: true });
    await act(async () => {
      await Promise.resolve();
      fireEvent.change(input, { target: { value: "send-email" } });
      fireEvent.click(screen.getByRole("checkbox", { name: "Pending" }));
    });
    expect(router.state.location.search.name).toBe("send-email");
    expect(router.state.location.search.status).toStrictEqual(["pending"]);
  });

  it("preserves spaces while typing a name into the URL-backed input", async () => {
    const { router } = await renderJobsRoute({
      fetch: createMockManagementFetch({ scenarioId: "large-dataset" }),
      initialEntry: "/jobs?limit=10",
    });
    const input = await screen.findByLabelText<HTMLInputElement>("Job name");
    vi.useFakeTimers({ shouldClearNativeTimers: true });
    await forEachSequential(["send", " ", "email"], async (suffix) => {
      const value = input.value + suffix;
      await act(async () => {
        await Promise.resolve();
        fireEvent.change(input, { target: { value } });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(router.state.location.search.name).toBe(value);
      expect(input.value).toBe(value);
    });
    expect(input.value).toBe("send email");
  });

  it.each(["toolbar", "navigation"])("clears a pending name through %s", async (source) => {
    const { router } = await renderJobsRoute({
      fetch: createMockManagementFetch({ scenarioId: "large-dataset" }),
      initialEntry: "/jobs?limit=10",
    });
    const input = await screen.findByLabelText<HTMLInputElement>("Job name");
    vi.useFakeTimers({ shouldClearNativeTimers: true });
    await act(async () => {
      await Promise.resolve();
      fireEvent.change(input, { target: { value: "send-email" } });
    });
    expect(router.state.location.search.name).toBe("send-email");
    await act(async () => {
      await Promise.resolve();
      if (source === "toolbar") {
        fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
        return;
      }
      await router.navigate({ to: "/jobs", search: parseJobsRouteSearch({}) });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(router.state.location.search.name).toBeUndefined();
    expect(screen.getByLabelText<HTMLInputElement>("Job name").value).toBe("");
  });

  it("does not restore a stale draft after navigating away and back to the original filter", async () => {
    const { router } = await renderJobsRoute({
      fetch: createMockManagementFetch({ scenarioId: "large-dataset" }),
      initialEntry: "/jobs?limit=10",
    });
    const input = await screen.findByLabelText<HTMLInputElement>("Job name");
    vi.useFakeTimers({ shouldClearNativeTimers: true });
    await act(async () => {
      await Promise.resolve();
      fireEvent.change(input, { target: { value: "unfinished" } });
    });
    await act(async () => {
      await Promise.resolve(
        router.navigate({ to: "/jobs", search: parseJobsRouteSearch({ name: "send-email" }) }),
      );
    });
    expect(screen.getByLabelText<HTMLInputElement>("Job name").value).toBe("send-email");
    await act(async () => {
      await Promise.resolve(router.navigate({ to: "/jobs", search: parseJobsRouteSearch({}) }));
    });
    expect(screen.getByLabelText<HTMLInputElement>("Job name").value).toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(router.state.location.search.name).toBeUndefined();
  });

  it("navigates with cursor pagination and keeps selection out of URL state", async () => {
    const { router } = await renderJobsRoute({
      fetch: createMockManagementFetch({ scenarioId: "large-dataset" }),
      initialEntry: "/jobs?limit=10",
    });
    const matchingCells = await screen.findAllByRole("cell", { name: /scenario-46003-/iu });
    expect(matchingCells.length).toBeGreaterThan(0);
    fireEvent.click(
      getFirstElement(screen.getAllByRole("checkbox", { name: /^Select job row /u })),
    );
    expect(router.state.location.search).not.toHaveProperty("selected");
    const nextPageButtons = screen.getAllByRole("link", { name: "Next page" });
    const nextPageButton = nextPageButtons.find(
      (link) => link.getAttribute("aria-disabled") !== "true",
    );
    if (!nextPageButton) {
      throw new Error("Expected an enabled next page button.");
    }
    fireEvent.click(nextPageButton);
    await waitFor(() => {
      expect({
        cursor: isString(router.state.location.search.cursor),
        limit: router.state.location.search.limit,
      }).toStrictEqual({ cursor: true, limit: 10 });
    });
  });

  it("preserves selected rows across refreshes when the rows remain valid", async () => {
    const { router } = await renderJobsRoute({
      fetch: createMockManagementFetch({ scenarioId: "pending-jobs" }),
      initialEntry: "/jobs?limit=10",
    });
    await screen.findAllByRole("checkbox", { name: /^Select job row /u });
    fireEvent.click(
      getFirstElement(screen.getAllByRole("checkbox", { name: /^Select job row /u })),
    );
    expect(router.state.location.search).not.toHaveProperty("selected");
    await waitFor(() => {
      expect(screen.getByText("1 rows selected on this page")).toBeInstanceOf(HTMLElement);
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(screen.getByText("1 rows selected on this page")).toBeInstanceOf(HTMLElement);
    });
  });

  it("clears page selection and cursor history when URL filters change", async () => {
    const { router } = await renderJobsRoute({
      fetch: createMockManagementFetch({ scenarioId: "large-dataset" }),
      initialEntry: "/jobs?limit=10",
    });
    await screen.findAllByRole("checkbox", { name: /^Select job row /u });
    await act(async () => {
      await Promise.resolve();
      fireEvent.click(screen.getByRole("link", { name: "Next page" }));
    });
    await waitFor(() => {
      expect(router.state.location.search.cursor).toStrictEqual(expect.any(String));
      expect(
        screen.getByRole("link", { name: "Previous page" }).getAttribute("aria-disabled"),
      ).not.toBe("true");
    });
    fireEvent.click(
      getFirstElement(await screen.findAllByRole("checkbox", { name: /^Select job row /u })),
    );
    await screen.findByText("1 rows selected on this page");
    await router.navigate({
      to: "/jobs",
      search: parseJobsRouteSearch({ name: "send-email", limit: 10 }),
    });
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Previous page" }).getAttribute("aria-disabled"),
      ).toBe("true");
      expect(screen.getByText("No rows selected")).toBeInstanceOf(HTMLElement);
    });
    await act(async () => {
      await Promise.resolve();
      fireEvent.click(screen.getByRole("link", { name: "Next page" }));
    });
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Previous page" }).getAttribute("aria-disabled"),
      ).not.toBe("true");
    });
    await act(async () => {
      await Promise.resolve();
      fireEvent.click(screen.getByRole("link", { name: "Previous page" }));
    });
    await waitFor(() => {
      expect(router.state.location.search.cursor).toBeUndefined();
      expect(router.state.location.search.name).toBe("send-email");
    });
  });

  it("renders an empty state when no jobs match the current view", async () => {
    await renderJobsRoute({
      fetch: createMockManagementFetch({ scenarioId: "empty-state" }),
      initialEntry: "/jobs",
    });
    await expect(screen.findByText("No jobs found")).resolves.toBeInstanceOf(HTMLElement);
  });

  it("keeps Previous page aligned with browser Back and offers First page after a reload", async () => {
    const fetch = createMockManagementFetch({ scenarioId: "large-dataset" });
    const { router } = await renderJobsRoute({ fetch, initialEntry: "/jobs?limit=10" });
    await screen.findAllByRole("checkbox", { name: /^Select job row /u });
    await act(
      async () =>
        await Promise.resolve(fireEvent.click(screen.getByRole("link", { name: "Next page" }))),
    );
    await waitFor(() => {
      expect(router.state.location.search.cursor).toStrictEqual(expect.any(String));
    });
    const secondPageCursor = router.state.location.search.cursor;
    await screen.findAllByRole("checkbox", { name: /^Select job row /u });
    await act(
      async () =>
        await Promise.resolve(fireEvent.click(screen.getByRole("link", { name: "Next page" }))),
    );
    await waitFor(() => {
      expect(router.state.location.search.cursor).not.toBe(secondPageCursor);
    });
    await act(async () => {
      await Promise.resolve();
      router.history.back();
    });
    await waitFor(() => {
      expect(router.state.location.search.cursor).toBe(secondPageCursor);
    });
    const previousPage = await screen.findByRole("link", { name: "Previous page" });
    await act(async () => await Promise.resolve(fireEvent.click(previousPage)));
    await waitFor(() => {
      expect(router.state.location.search.cursor).toBeUndefined();
    });
    cleanup();
    const reloaded = await renderJobsRoute({
      fetch,
      initialEntry: `/jobs?limit=10&cursor=${encodeURIComponent(String(secondPageCursor))}`,
    });
    const firstPage = await screen.findByRole("link", { name: "First page" });
    await act(async () => await Promise.resolve(fireEvent.click(firstPage)));
    await waitFor(() => {
      expect(reloaded.router.state.location.search.cursor).toBeUndefined();
    });
  });

  it("renders an unauthorized state when the API returns 401", async () => {
    await renderJobsRoute({
      fetch: createMockManagementFetch({ scenarioId: "unauthorized" }),
      initialEntry: "/jobs",
    });
    await expect(screen.findByText("Sign in required")).resolves.toBeInstanceOf(HTMLElement);
  });

  it("renders a forbidden state when the API returns 403", async () => {
    cleanup();
    await renderJobsRoute({
      fetch: createForbiddenFetch(),
      initialEntry: "/jobs",
    });
    await expect(screen.findByText("Access denied")).resolves.toBeInstanceOf(HTMLElement);
  });

  it("disables row actions until an outstanding mutation and its refresh finish", async () => {
    const job = createListJob();
    const otherJob = createListJob({ id: "other-job", name: "other-job" });
    const state = createJobsActionFetch({ jobs: [job, otherJob] });
    const response = Promise.withResolvers<Response>();
    const refresh = Promise.withResolvers<Response>();
    let listRequests = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "POST") {
        return await response.promise;
      }
      if (new URL(request.url).pathname === "/api/v1/jobs" && (listRequests += 1) > 1) {
        return await refresh.promise;
      }
      return await state.fetch(request);
    });
    await renderJobsRoute({ fetch, initialEntry: "/jobs" });
    const actionButton = () => screen.getByRole("button", { name: `Actions for ${job.id}` });
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Select job row other-job other-job" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: `Actions for ${job.id}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancel job" }));
    await waitFor(() => {
      expect(
        fetch.mock.calls.some(([input]) => input instanceof Request && input.method === "POST"),
      ).toBe(true);
    });
    try {
      expect(actionButton().hasAttribute("disabled")).toBe(true);
      await act(async () => {
        await Promise.resolve();
        response.resolve(createJsonResponse({ cancelled: true }));
      });
      await waitFor(() => {
        expect(listRequests).toBe(2);
      });
      expect(actionButton().hasAttribute("disabled")).toBe(true);
    } finally {
      await act(async () => {
        await Promise.resolve();
        response.resolve(createJsonResponse({ cancelled: true }));
        refresh.resolve(
          createJsonResponse({
            jobs: [{ ...job, status: "cancelled" }, otherJob],
            cursor: null,
            hasNextPage: false,
            hasPreviousPage: false,
          }),
        );
      });
    }
    await waitFor(() => {
      expect(actionButton().hasAttribute("disabled")).toBe(false);
    });
    expect(
      screen
        .getByRole("checkbox", { name: "Select job row other-job other-job" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(actionButton());
    const awaitedResult1 = await screen.findByRole("menuitem", { name: "Cancel job" });
    expect(awaitedResult1.getAttribute("aria-disabled")).toBe("true");
  });

  it.each(["filters", "cursor"] as const)(
    "dismisses bulk confirmation when browser Back changes %s",
    async (change) => {
      const { router } = await renderJobsRoute({
        fetch: createMockManagementFetch({ scenarioId: "large-dataset" }),
        initialEntry: "/jobs?limit=10",
      });
      await screen.findByRole("heading", { name: "Jobs" });
      const firstRow = getFirstElement(
        await screen.findAllByRole("checkbox", { name: /^Select job row /u }),
      ).getAttribute("aria-label");
      if (change === "cursor") {
        fireEvent.click(await screen.findByRole("link", { name: "Next page" }));
      } else {
        await act(async () => {
          await router.navigate({
            to: "/jobs",
            search: parseJobsRouteSearch({ limit: 10, status: ["pending"] }),
          });
        });
      }
      await waitFor(() => {
        expect({
          hasCursor: isString(router.state.location.search.cursor),
          status: router.state.location.search.status,
          rowChanged:
            change !== "cursor" ||
            getFirstElement(
              screen.getAllByRole("checkbox", { name: /^Select job row /u }),
            ).getAttribute("aria-label") !== firstRow,
        }).toStrictEqual(
          change === "cursor"
            ? { hasCursor: true, status: [], rowChanged: true }
            : { hasCursor: false, status: ["pending"], rowChanged: true },
        );
      });
      fireEvent.click(
        getFirstElement(await screen.findAllByRole("checkbox", { name: /^Select job row /u })),
      );
      const deleteButton = screen.getByRole("button", { name: "Delete selected jobs" });
      await waitFor(() => {
        expect(deleteButton.hasAttribute("disabled")).toBe(false);
      });
      fireEvent.click(deleteButton);
      await expect(screen.findByRole("dialog")).resolves.toBeInstanceOf(HTMLElement);
      await act(async () => {
        await Promise.resolve();
        router.history.back();
      });
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
    },
  );

  it("preserves an open action confirmation when the Jobs list polls", async () => {
    const job = createListJob();
    const fetchState = createJobsActionFetch({ jobs: [job] });
    await renderJobsRoute({
      fetch: fetchState.fetch,
      initialEntry: "/jobs",
      pollingIntervalMs: 100,
    });
    fireEvent.click(
      getFirstElement(await screen.findAllByRole("checkbox", { name: /^Select job row /u })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selected jobs" }));
    await expect(screen.findByRole("dialog")).resolves.toBeInstanceOf(HTMLElement);
    const reads = fetchState.listRequestCount;
    await waitFor(() => {
      expect(fetchState.listRequestCount).toBeGreaterThan(reads);
    });
    expect(screen.getByRole("button", { name: "Confirm delete selected jobs" })).toBeInstanceOf(
      HTMLElement,
    );
  });

  it("deletes only explicitly selected jobs after bulk confirmation and refetches the list", async () => {
    const jobA = createListJob({
      id: "job-bulk-a",
      name: "send-email",
      status: "pending",
    });
    const jobB = createListJob({
      id: "job-bulk-b",
      name: "dispatch-webhook",
      status: "pending",
    });
    const fetchState = createJobsActionFetch({
      jobs: [jobA, jobB],
    });
    await renderJobsRoute({
      fetch: fetchState.fetch,
      initialEntry: "/jobs",
    });
    const awaitedResult2 = await screen.findAllByText(jobA.id);
    expect({
      firstVisible: awaitedResult2.length > 0,
      secondVisible: screen.getAllByText(jobB.id).length > 0,
    }).toStrictEqual({ firstVisible: true, secondVisible: true });
    fireEvent.click(
      getFirstElement(screen.getAllByRole("checkbox", { name: /^Select job row /u })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete selected jobs" }));
    await expect(
      screen.findByRole("heading", { name: "Delete selected jobs?" }),
    ).resolves.toBeInstanceOf(HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete selected jobs" }));
    await waitFor(() => {
      expect(screen.queryByText(jobA.id)).toBeNull();
    });
    expect(screen.getAllByText(jobB.id).length).toBeGreaterThan(0);
    expect(fetchState.deletedJobIds).toStrictEqual(["job-bulk-a"]);
    expect(fetchState.listRequestCount).toBeGreaterThanOrEqual(2);
  });
});
