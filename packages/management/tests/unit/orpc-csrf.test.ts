import { describe, expect, test, vi } from "vite-plus/test";

import { createManagementSurface } from "@/surface";

import { createManagementMonque } from "./management-test-utils.js";

describe("Management HTTP mutation origins", () => {
  test("rejects a cookie-authenticated form from a sibling origin before deleting jobs", async () => {
    const deleteJobs = vi.fn(async () => ({ count: 3, errors: [] }));
    const authorize = vi.fn(() => true);
    const surface = createManagementSurface({
      monque: createManagementMonque({ deleteJobs }),
      authorize,
    });
    const result = await surface.openApiHandler.handle(
      new Request("https://ops.example.com/api/v1/jobs/actions/delete", {
        method: "POST",
        body: "",
        headers: {
          origin: "https://evil.example.com",
          cookie: "session=valid-operator",
          "content-type": "application/x-www-form-urlencoded",
          "sec-fetch-site": "same-site",
        },
      }),
      { context: {} },
    );

    expect(result.matched).toBe(true);
    expect(result.response?.status).toBe(403);
    expect(await result.response?.json()).toEqual({ error: "Untrusted request origin" });
    expect(authorize).not.toHaveBeenCalled();
    expect(deleteJobs).not.toHaveBeenCalled();
  });

  test.each([
    ["POST", "/api/v1/processing/actions/pause"],
    ["POST", "/api/v1/processing/actions/resume"],
    ["POST", "/api/v1/jobs/507f1f77bcf86cd799439011/actions/cancel"],
    ["POST", "/api/v1/jobs/507f1f77bcf86cd799439011/actions/retry"],
    ["POST", "/api/v1/jobs/507f1f77bcf86cd799439011/actions/reschedule"],
    ["POST", "/api/v1/jobs/507f1f77bcf86cd799439011/actions/priority"],
    ["DELETE", "/api/v1/jobs/507f1f77bcf86cd799439011"],
    ["POST", "/api/v1/jobs/actions/cancel"],
    ["POST", "/api/v1/jobs/actions/retry"],
    ["POST", "/api/v1/jobs/actions/delete"],
    ["POST", "/api/v1/jobs/actions/selected"],
  ])("rejects an untrusted origin for %s %s before body decoding", async (method, path) => {
    const getJob = vi.fn(async () => null);
    const authorize = vi.fn(() => true);
    const surface = createManagementSurface({
      monque: createManagementMonque({ getJob }, { mutations: true }),
      authorize,
    });
    const init: RequestInit = {
      method,
      headers: { origin: "https://attacker.test", "content-type": "application/json" },
      body: "invalid json",
    };
    const mutation = new Request(`https://ops.example.com${path}`, init);
    const result = await surface.openApiHandler.handle(mutation, { context: {} });

    expect(result.response?.status).toBe(403);
    expect(mutation.bodyUsed).toBe(false);
    expect(authorize).not.toHaveBeenCalled();
    expect(getJob).not.toHaveBeenCalled();
  });

  test.each([
    "null",
    "https://ops.example.com/",
    "https://ops.example.com/path",
    "https://operator@ops.example.com",
    "https://ops.example.com#fragment",
    "https://ops.example.com?query=1",
    "https://ops.example.com https://attacker.test",
    "https://ops.example.com, https://attacker.test",
    "https://ops.example.com:444",
    "http://ops.example.com",
    "file://ops.example.com",
    "",
  ])("rejects origin %j even with same-origin Fetch Metadata", async (origin) => {
    const deleteJobs = vi.fn(async () => ({ count: 0, errors: [] }));
    const surface = createManagementSurface({ monque: createManagementMonque({ deleteJobs }) });
    const result = await surface.openApiHandler.handle(
      new Request("https://ops.example.com/api/v1/jobs/actions/delete", {
        method: "POST",
        headers: { origin, "sec-fetch-site": "same-origin" },
      }),
      { context: {} },
    );

    expect(result.response?.status).toBe(403);
    expect(deleteJobs).not.toHaveBeenCalled();
  });

  test.each(["same-site", "cross-site", "invalid"])(
    "rejects originless browser mutations with %s Fetch Metadata",
    async (fetchSite) => {
      const deleteJobs = vi.fn(async () => ({ count: 0, errors: [] }));
      const surface = createManagementSurface({ monque: createManagementMonque({ deleteJobs }) });
      const result = await surface.openApiHandler.handle(
        new Request("https://ops.example.com/api/v1/jobs/actions/delete", {
          method: "POST",
          headers: { "sec-fetch-site": fetchSite },
        }),
        { context: {} },
      );

      expect(result.response?.status).toBe(403);
      expect(deleteJobs).not.toHaveBeenCalled();
    },
  );

  test.each([
    { origin: "https://ops.example.com", "sec-fetch-site": "same-origin" },
    { origin: "https://dashboard.example.com", "sec-fetch-site": "same-site" },
    { origin: "https://dashboard.example.com", "sec-fetch-site": "cross-site" },
    {},
    { "sec-fetch-site": "same-origin" },
    { "sec-fetch-site": "none" },
  ])("allows approved browser and server mutations with %j", async (headers) => {
    const deleteJobs = vi.fn(async () => ({ count: 3, errors: [] }));
    const surface = createManagementSurface({
      monque: createManagementMonque({ deleteJobs }),
      trustedOrigins: ["https://dashboard.example.com"],
    });
    const result = await surface.openApiHandler.handle(
      new Request("https://ops.example.com/api/v1/jobs/actions/delete", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: "{}",
      }),
      { context: {} },
    );

    expect(result.response?.status).toBe(200);
    expect(await result.response?.json()).toEqual({ count: 3, errors: [] });
    expect(deleteJobs).toHaveBeenCalledWith({});
  });

  test("allows read routes from untrusted origins", async () => {
    const surface = createManagementSurface({ monque: createManagementMonque() });
    const result = await surface.openApiHandler.handle(
      new Request("https://ops.example.com/api/v1/health", {
        headers: { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
      }),
      { context: {} },
    );

    expect(result.response?.status).toBe(200);
  });

  test("leaves unmatched unsafe requests to the host without decoding their bodies", async () => {
    const surface = createManagementSurface({ monque: createManagementMonque() });
    const mutation = new Request("https://ops.example.com/other-host-feature", {
      method: "POST",
      headers: { origin: "https://attacker.test", "content-type": "application/json" },
      body: "invalid json",
    });
    const result = await surface.openApiHandler.handle(mutation, { context: {} });

    expect(result).toEqual({ matched: false, response: undefined });
    expect(mutation.bodyUsed).toBe(false);
  });

  test.each(["null", "*", "https://dashboard.example.com/", "https://user@dashboard.example.com"])(
    "rejects invalid trusted origin configuration %j",
    (trustedOrigin) => {
      expect(() =>
        createManagementSurface({
          monque: createManagementMonque(),
          trustedOrigins: [trustedOrigin],
        }),
      ).toThrow("Invalid trusted origin");
    },
  );
});
