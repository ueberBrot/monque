import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createDashboardManagementApi } from "@/management-client";

import { createMockManagementFetch } from "../../src/mock/management-server.js";
import { createScenarioHeaderFetch } from "../../src/scenario-header-fetch.js";

describe("scenario header fetch", () => {
  afterEach(() => vi.unstubAllGlobals());
  describe("scenario fetch adapter", () => {
    it("reschedules through the dashboard client without dropping its JSON content type", async () => {
      const mockFetch = createMockManagementFetch();
      const received: Request[] = [];
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        received.push(request.clone());
        return await mockFetch(request);
      });
      const api = createDashboardManagementApi({
        apiBaseUrl: "/",
        origin: "https://dashboard-dev.example",
        fetch: createScenarioHeaderFetch("pending-jobs"),
      });
      const awaitedResult1 = await api.client.jobs({ status: "pending", limit: "1" });
      const [job] = awaitedResult1.jobs;
      if (!job) {
        throw new Error("Missing pending scenario job");
      }
      const nextRunAt = "2035-10-01T12:30:00.000Z";
      await api.client.rescheduleJob({ params: { id: job.id }, body: { nextRunAt } });
      const awaitedResult2 = await api.client.job({ params: { id: job.id } });
      expect(awaitedResult2.nextRunAt).toBe(nextRunAt);
      const mutation = received.find((request) => request.method === "POST");
      expect(mutation?.headers.get("content-type")).toContain("application/json");
      expect(mutation?.headers.get("x-monque-dev-scenario")).toBe("pending-jobs");
      expect(mutation?.credentials).toBe("include");
      await expect(mutation?.json()).resolves.toStrictEqual({ nextRunAt });
    });

    it("preserves request options and applies init overrides without changing input headers", async () => {
      const controller = new AbortController();
      const original = new Request("https://dashboard-dev.example/api/v1/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-original": "preserved" },
        body: JSON.stringify({ nextRunAt: "2035-10-01T12:30:00Z" }),
        signal: controller.signal,
        credentials: "include",
        cache: "no-store",
        redirect: "manual",
      });
      let received: Request | undefined;
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        received = new Request(input, init);
        return await Promise.resolve(new Response(null, { status: 204 }));
      });
      await createScenarioHeaderFetch("pending-jobs")(original, {
        headers: { "content-type": "application/json", "x-override": "replacement" },
      });
      expect({
        scenario: original.headers.has("x-monque-dev-scenario"),
        original: original.headers.get("x-original"),
      }).toStrictEqual({ scenario: false, original: "preserved" });
      if (!received) {
        throw new Error("Fetch did not receive a request");
      }
      expect({
        override: received.headers.get("x-override"),
        original: received.headers.has("x-original"),
        scenario: received.headers.get("x-monque-dev-scenario"),
        method: received.method,
        url: received.url,
        credentials: received.credentials,
        cache: received.cache,
        redirect: received.redirect,
      }).toStrictEqual({
        override: "replacement",
        original: false,
        scenario: "pending-jobs",
        method: "POST",
        url: original.url,
        credentials: "include",
        cache: "no-store",
        redirect: "manual",
      });
      await expect(received.json()).resolves.toStrictEqual({ nextRunAt: "2035-10-01T12:30:00Z" });
      controller.abort();
      expect(received.signal.aborted).toBe(true);
    });
  });
});
