// @vitest-environment jsdom
import { createMockManagementFetch } from "@dashboard-dev/mock/management-server";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { isString } from "../../../../packages/dashboard/src/lib/type-guards.js";
import { createDashboardHarness } from "../setup/dashboard-harness.js";

const renderDashboardAt = (
  pathname: string,
  options?: {
    readonly fetch?: typeof fetch;
    readonly pollingIntervalMs?: number;
    readonly scenarioId?: "pending-jobs" | "unauthorized";
  },
): void => {
  createDashboardHarness(pathname, {
    ...options,
    pollingIntervalMs: options?.pollingIntervalMs ?? 15_000,
  }).render();
};
const pause = async (durationMs: number): Promise<void> => {
  const pending: PromiseWithResolvers<void> = Promise.withResolvers();
  window.setTimeout(() => {
    pending.resolve();
  }, durationMs);
  await pending.promise;
};
const setDocumentVisibilityState = (state: "hidden" | "visible"): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};
describe("queue views route", () => {
  describe("Queue Views routes", () => {
    it("renders Queue Views from the Management API on the overview route", async () => {
      renderDashboardAt("/queue-views");
      await expect(screen.findByRole("heading", { name: "Queue Views" })).resolves.toBeInstanceOf(
        HTMLElement,
      );
      await expect(
        screen.findByText("Jobs grouped by name. Open a view to investigate."),
      ).resolves.toBeInstanceOf(HTMLElement);
      expect(screen.getByText("dispatch-webhook")).toBeInstanceOf(HTMLElement);
      expect(screen.getByText("send-email")).toBeInstanceOf(HTMLElement);
    });

    it("navigates from the overview route into Queue View detail by job name", async () => {
      renderDashboardAt("/queue-views");
      fireEvent.click(await screen.findByText("send-email"));
      await expect(screen.findByRole("heading", { name: "Filtered jobs" })).resolves.toBeInstanceOf(
        HTMLElement,
      );
      expect(screen.getByRole("heading", { level: 1, name: "send-email" })).toBeInstanceOf(
        HTMLElement,
      );
      expect(screen.queryByLabelText(/job name/iu)).toBeNull();
      expect({
        failureLimit: screen.getByText("Failure limit").nextElementSibling?.textContent,
        retryDelay: screen.getByText("Base retry delay").nextElementSibling?.textContent,
        validation: screen.getByText("Payload validation").nextElementSibling?.textContent,
      }).toStrictEqual({ failureLimit: "3", retryDelay: "1000 ms", validation: "Not configured" });
      fireEvent.click(await screen.findByRole("button", { name: "Pause worker" }));
      await expect(screen.findByRole("button", { name: "Resume worker" })).resolves.toBeInstanceOf(
        HTMLElement,
      );
    });

    it("loads queue detail with summary jobs and a single statistics source", async () => {
      const calls: string[] = [];
      const mockFetch = createMockManagementFetch({ scenarioId: "pending-jobs" });
      renderDashboardAt("/queue-views/send-email", {
        fetch: async (input, init) => {
          calls.push(input instanceof Request ? input.url : String(input));
          return await mockFetch(input, init);
        },
      });
      await expect(screen.findByRole("heading", { name: "Filtered jobs" })).resolves.toBeInstanceOf(
        HTMLElement,
      );
      expect(calls.some((url) => url.includes("/jobs/stats"))).toBe(false);
      expect(calls.some((url) => new URL(url).searchParams.get("view") === "summary")).toBe(true);
      expect(calls.filter((url) => new URL(url).pathname === "/api/v1/queue-views")).toStrictEqual([
        "https://dashboard.test/api/v1/queue-views?name=send-email",
      ]);
    });

    it("offers another queue page only while more jobs exist", async () => {
      renderDashboardAt("/queue-views/send-email?limit=4");
      fireEvent.click(await screen.findByRole("link", { name: "Next page" }));
      await expect(
        screen.findByRole("link", { name: "Back to first page" }),
      ).resolves.toBeInstanceOf(HTMLElement);
      expect(screen.getByText("4 jobs on this page")).toBeInstanceOf(HTMLElement);
      expect(screen.queryByRole("link", { name: "Next page" })).toBeNull();
    });

    it("stops automatic requests after authorization is denied", async () => {
      let requests = 0;
      renderDashboardAt("/queue-views", {
        pollingIntervalMs: 25,
        fetch: async () => {
          requests += 1;
          return await Promise.resolve(Response.json({ error: "Sign in" }, { status: 401 }));
        },
      });
      await screen.findByRole("heading", { name: "Authentication required" });
      await pause(180);
      expect(requests).toBe(1);
    });

    it.each(["/queue-views", "/queue-views/send-email"])(
      "distinguishes forbidden access and recovers without navigation on %s",
      async (path) => {
        let denied = true;
        const mockFetch = createMockManagementFetch({ scenarioId: "pending-jobs" });
        renderDashboardAt(path, {
          fetch: async (input, init) =>
            await Promise.resolve(
              denied
                ? Promise.resolve(
                    Response.json({ error: "Host permission denied." }, { status: 403 }),
                  )
                : mockFetch(input, init),
            ),
        });
        await expect(
          screen.findByRole("heading", { name: "Access denied" }),
        ).resolves.toBeInstanceOf(HTMLElement);
        expect(screen.getByRole("alert").textContent).toContain("Host permission denied.");
        denied = false;
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await expect(
          screen.findByRole("heading", {
            name: path === "/queue-views" ? "Queue Views" : "Filtered jobs",
          }),
        ).resolves.toBeInstanceOf(HTMLElement);
        expect(window.location.pathname).toBe(path);
      },
    );

    it("polls while visible and pauses polling while the document is hidden", async () => {
      const calls: string[] = [];
      const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = (() => {
          if (isString(input)) {
            return input;
          }
          if (input instanceof URL) {
            return input.toString();
          }
          return input.url;
        })();
        calls.push(url);
        return await createMockManagementFetch({ scenarioId: "pending-jobs" })(input, init);
      };
      renderDashboardAt("/queue-views", { fetch, pollingIntervalMs: 25 });
      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(0);
      });
      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(1);
      });
      const hiddenCount = calls.length;
      setDocumentVisibilityState("hidden");
      await waitFor(async () => {
        await pause(80);
        expect(calls).toHaveLength(hiddenCount);
      });
      setDocumentVisibilityState("visible");
      await waitFor(() => {
        expect(calls.length).toBeGreaterThan(hiddenCount);
      });
    }, 10_000);
  });
  afterEach(() => {
    cleanup();
    setDocumentVisibilityState("visible");
  });
});
