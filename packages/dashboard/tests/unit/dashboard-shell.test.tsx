// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { DashboardShell } from "@/components/dashboard-shell";

const renderShell = async (path: string) => {
  const root = createRootRoute({
    component: () => (
      <DashboardShell>
        <div>Route content</div>
      </DashboardShell>
    ),
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    routeTree: root.addChildren(
      ["/queue-views", "/jobs", "/health"].map((currentPath1) =>
        createRoute({ getParentRoute: () => root, path: currentPath1 }),
      ),
    ),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("Route content");
  return router;
};
const getThemeButton = (): HTMLElement => {
  const themeButtons = screen.getAllByRole("button", { name: "Change theme" });
  const [firstThemeButton] = themeButtons;
  if (!firstThemeButton) {
    throw new Error("Expected at least one theme button.");
  }
  return firstThemeButton;
};
const getDialogContent = (): HTMLElement => {
  const dialogContent = screen
    .getByText("Dashboard navigation")
    .closest('[data-slot="dialog-content"]');
  if (!(dialogContent instanceof HTMLElement)) {
    throw new Error("Expected dashboard navigation to be inside dialog content.");
  }
  return dialogContent;
};
describe(DashboardShell, () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps navigation and theme changes working when browser storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    const router = await renderShell("/jobs");
    fireEvent.click(getThemeButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "Dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Health" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/health");
    });
  });

  it("renders primary navigation and opens the mobile drawer", async () => {
    const router = await renderShell("/queue-views");
    expect(
      ["Queue Views", "Jobs", "Health"].map((label) => screen.getAllByText(label).length > 0),
    ).toStrictEqual([true, true, true]);
    expect(screen.queryByText("Dashboard navigation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialogContent = getDialogContent();
    expect({
      title: screen.getByText("Dashboard navigation").textContent,
      fillsHeight:
        dialogContent.classList.contains("top-0") && dialogContent.classList.contains("bottom-0"),
      content: screen.getByText("Route content").textContent,
    }).toStrictEqual({
      title: "Dashboard navigation",
      fillsHeight: true,
      content: "Route content",
    });
    fireEvent.click(within(dialogContent).getByRole("link", { name: "Jobs" }));
    await waitFor(() => {
      expect({
        path: router.state.location.pathname,
        drawer: screen.queryByText("Dashboard navigation"),
      }).toStrictEqual({ path: "/jobs", drawer: null });
    });
    expect(screen.getByRole("link", { name: "Jobs" }).getAttribute("aria-current")).toBe("page");
  });

  it("lets the operator switch theme modes", async () => {
    await renderShell("/jobs");
    fireEvent.click(getThemeButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "Dark theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    fireEvent.click(getThemeButton());
    fireEvent.click(screen.getByRole("menuitem", { name: "System theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
