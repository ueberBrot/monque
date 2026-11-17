import { describe, expect, it } from "vite-plus/test";

import { createDashboardManagementApi } from "@/management-client";

import { rpcResponse } from "../setup/rpc";

describe(createDashboardManagementApi, () => {
  it("rejects an invalid URL before obtaining the fetch implementation", () => {
    expect(() =>
      createDashboardManagementApi({
        // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- This literal is a test fixture or import-matching pattern, not an outgoing network request.
        apiBaseUrl: "http://[",
        origin: "https://dashboard.example",
        get fetch(): typeof fetch {
          throw new Error("Fetch is unavailable");
        },
      }),
    ).toThrow(TypeError);
  });

  it("preserves the Management error message and HTTP status for action feedback", async () => {
    const managementApi = createDashboardManagementApi({
      apiBaseUrl: "/",
      origin: "https://dashboard.example",
      fetch: async () =>
        await Promise.resolve(
          rpcResponse(
            { error: "Job state changed." },
            {
              status: 409,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
    });

    await expect(managementApi.client.cancelJob({ params: { id: "job-1" } })).rejects.toMatchObject(
      {
        code: "CONFLICT",
        message: "Job state changed.",
      },
    );
  });

  it("appends RPC beneath a custom mount and preserves URL search parameters", async () => {
    let url: URL | undefined;

    const api = createDashboardManagementApi({
      apiBaseUrl: "/custom/management/?tenant=one",
      origin: "https://dashboard.example",
      fetch: async (request) => {
        url = new URL(request instanceof Request ? request.url : String(request));

        return await Promise.resolve(rpcResponse({ status: "ok", scheduler: { healthy: true } }));
      },
    });

    await api.client.health();
    expect(url?.pathname).toBe("/custom/management/rpc/health");
    expect(url?.searchParams.get("tenant")).toBe("one");
  });

  it("retains host authentication status when its JSON response is malformed", async () => {
    const api = createDashboardManagementApi({
      apiBaseUrl: "/custom/management",
      origin: "https://dashboard.example",
      fetch: async () =>
        await Promise.resolve(
          new Response("{", {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
        ),
    });

    await expect(api.client.health()).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("includes browser credentials by default on Management API requests", async () => {
    let capturedCredentials: RequestCredentials | undefined;

    const managementApi = createDashboardManagementApi({
      apiBaseUrl: "/api/management",
      fetch: async (_request, init) => {
        capturedCredentials = init?.credentials;

        return await Promise.resolve(
          rpcResponse(
            { status: "ok", scheduler: { healthy: true } },
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      },
      origin: "https://dashboard.example",
    });

    await managementApi.client.health();
    expect(capturedCredentials).toBe("include");
  });
});
