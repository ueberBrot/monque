// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { fromPartial } from "@total-typescript/shoehorn";
import { createElement, StrictMode } from "react";
import { describe, afterEach, expect, it, vi } from "vite-plus/test";

import type * as ManagementClientModule from "@/management-client";
import type * as ProvidersModule from "@/providers";
import { DashboardProviders } from "@/providers";
import type * as QueryClientModule from "@/query-client";
import { createDashboardQueryClient } from "@/query-client";
import type * as RouterModule from "@/router";
import type { getRouter } from "@/router";

import { DashboardDevShellApp } from "../../src/dev-shell-app.js";
import type { DashboardDevEnvironment } from "../../src/environment.js";

vi.mock(import("@/management-client"), () =>
  fromPartial<typeof ManagementClientModule>({ createDashboardManagementApi: () => ({}) }),
);
vi.mock(import("@/query-client"), () =>
  fromPartial<typeof QueryClientModule>({
    createDashboardQueryClient: vi.fn<typeof createDashboardQueryClient>(() =>
      fromPartial<ReturnType<typeof createDashboardQueryClient>>({}),
    ),
  }),
);
vi.mock(import("@/router"), () =>
  fromPartial<typeof RouterModule>({
    getRouter: vi.fn<typeof getRouter>(() => fromPartial<ReturnType<typeof getRouter>>({})),
  }),
);
vi.mock(import("@/providers"), () =>
  fromPartial<typeof ProvidersModule>({
    DashboardProviders: vi.fn<
      (...args: Parameters<typeof ProvidersModule.DashboardProviders>) => null
    >(() => null),
  }),
);
const renderShell = (config: DashboardDevEnvironment) =>
  createElement(StrictMode, null, createElement(DashboardDevShellApp, { environment: config }));
describe("dev shell environment", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it.each([null, "invalid-scenario"])(
    "uses the supplied default scenario when the saved preference is %s",
    (stored) => {
      if (!(stored === undefined || stored === null || stored === "")) {
        localStorage.setItem("monque-dashboard-dev-scenario", stored);
      }
      render(
        createElement(DashboardDevShellApp, {
          environment: { mode: "mock", scenarioId: "failed-jobs" },
        }),
      );
      expect(localStorage.getItem("monque-dashboard-dev-scenario")).toBe("failed-jobs");
    },
  );

  it("preserves a valid saved scenario over the supplied default", () => {
    localStorage.setItem("monque-dashboard-dev-scenario", "empty-state");
    render(
      createElement(DashboardDevShellApp, {
        environment: { mode: "mock", scenarioId: "failed-jobs" },
      }),
    );
    expect(localStorage.getItem("monque-dashboard-dev-scenario")).toBe("empty-state");
  });

  it("reuses runtime clients across StrictMode rerenders and recreates them for a keyed mode change", () => {
    const environment: DashboardDevEnvironment = { mode: "mock", scenarioId: "pending-jobs" };
    const view = render(renderShell(environment));
    const initial = vi.mocked(DashboardProviders).mock.calls.at(-1)?.[0];
    expect(initial).toBeDefined();
    const creations = vi.mocked(createDashboardQueryClient).mock.calls.length;
    view.rerender(renderShell({ ...environment }));
    const stable = vi.mocked(DashboardProviders).mock.calls.at(-1)?.[0];
    expect({
      queryClient: stable?.queryClient === initial?.queryClient,
      router: stable?.router === initial?.router,
      creations: vi.mocked(createDashboardQueryClient).mock.calls.length,
    }).toStrictEqual({ queryClient: true, router: true, creations });
    view.rerender(renderShell({ mode: "db", scenarioId: "pending-jobs" }));
    const remounted = vi.mocked(DashboardProviders).mock.calls.at(-1)?.[0];
    expect({
      queryClient: remounted?.queryClient !== initial?.queryClient,
      router: remounted?.router !== initial?.router,
    }).toStrictEqual({ queryClient: true, router: true });
  });
});
