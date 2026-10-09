import { describe, expect, it } from "vite-plus/test";

import { DashboardRuntimeConfigSchema, parseDashboardRuntimeConfig } from "@/runtime-config";

describe(parseDashboardRuntimeConfig, () => {
  it("normalizes mount-aware base paths", () => {
    expect(
      parseDashboardRuntimeConfig({
        apiBaseUrl: "/api/management",
        basePath: "dashboard/",
        pollingIntervalMs: 15_000,
      }),
    ).toStrictEqual({
      apiBaseUrl: "/api/management",
      basePath: "/dashboard",
      pollingIntervalMs: 15_000,
    });
    expect(
      parseDashboardRuntimeConfig({
        apiBaseUrl: "/api/management",
        basePath: "/",
      }),
    ).toStrictEqual({
      apiBaseUrl: "/api/management",
      basePath: "/",
    });
  });

  it.each([
    "/api/management",
    "management",
    "/",
    "https://api.example.test/management",
    "http://localhost:3000/api",
  ])("accepts supported API base URL %s", (apiBaseUrl) => {
    expect(parseDashboardRuntimeConfig({ apiBaseUrl, basePath: "/dashboard" }).apiBaseUrl).toBe(
      apiBaseUrl,
    );
  });

  it.each([
    "",
    "   ",
    "http://[",
    // oxlint-disable-next-line eslint/no-script-url -- The validator must reject script URLs.
    "javascript:alert(1)",
    "file:///api",
    "data:text/html,hello",
    " https://example.test",
    "/api\\management",
  ])("rejects invalid API base URL %j", (apiBaseUrl) => {
    expect(() => parseDashboardRuntimeConfig({ apiBaseUrl, basePath: "/dashboard" })).toThrow(
      "apiBaseUrl",
    );
  });

  it.each([
    "",
    " ",
    "//dashboard",
    "/dashboard?tab=jobs",
    "/dashboard#jobs",
    "/ops/../dashboard",
    "/%2e%2e/dashboard",
    "https://example.test/dashboard",
    "/ops\\dashboard",
  ])("rejects invalid mount path %j", (basePath) => {
    expect(() => parseDashboardRuntimeConfig({ apiBaseUrl: "/api", basePath })).toThrow("basePath");
  });

  it("rejects unknown runtime config keys", () => {
    expect(() =>
      DashboardRuntimeConfigSchema.parse({
        apiBaseUrl: "/api/management",
        basePath: "/dashboard",
        unexpected: true,
      }),
    ).toThrow(/Unrecognized key/u);
  });
});
