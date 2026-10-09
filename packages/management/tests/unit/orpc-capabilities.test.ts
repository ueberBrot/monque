import { describe, expect, vi, it } from "vite-plus/test";

import { createManagementSurface } from "@/index";
import type { ManagementMonque } from "@/surface";
import {
  createManagementMonque,
  expectJsonResponse,
  handleManagementGet,
  handleManagementPost,
} from "@tests/unit/management-test-utils";

describe("oRPC Management capabilities route", () => {
  it("evaluates authorization checks sequentially by default", async () => {
    const checks: string[] = [];
    let active = 0;
    let maximum = 0;
    const surface = createManagementSurface({
      monque: createManagementMonque({}, { mutations: true }),
      authorize: async ({ action }) => {
        checks.push(action);
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return true;
      },
    });

    const response = await handleManagementGet(surface, "/api/v1/capabilities");

    expect(response.status).toBe(200);
    expect(maximum).toBe(1);
    expect(checks).toStrictEqual([
      "read",
      "cancel",
      "cancelBulk",
      "retry",
      "retryBulk",
      "reschedule",
      "delete",
      "deleteBulk",
    ]);
  });

  it("can evaluate independent capability checks concurrently without sharing request context", async () => {
    const gate: PromiseWithResolvers<void> = Promise.withResolvers();
    const checks: string[] = [];
    const surface = createManagementSurface<{ user: string }>({
      monque: createManagementMonque({}, { mutations: true }),
      parallelCapabilityChecks: true,
      authorize: async ({ action, context }) => {
        checks.push(`${context.user}:${action}`);
        await gate.promise;
        return action === (context.user === "alice" ? "read" : "retry");
      },
    });
    const pending = Promise.all([
      handleManagementGet(surface, "/api/v1/capabilities", {
        managementContext: { user: "alice" },
      }),
      handleManagementGet(surface, "/api/v1/capabilities", {
        managementContext: { user: "bob" },
      }),
    ]);
    try {
      await vi.waitFor(() => {
        expect(checks).toHaveLength(16);
      });
    } finally {
      gate.resolve();
    }
    const [aliceResponse, bobResponse] = await pending;
    expect(aliceResponse.status).toBe(200);
    expect(bobResponse.status).toBe(200);
    await expect(aliceResponse.json()).resolves.toMatchObject({
      actions: { read: true, retry: false, delete: false },
    });
    await expect(bobResponse.json()).resolves.toMatchObject({
      actions: { read: false, retry: true, delete: false },
    });
    expect({
      alice: checks.filter((check) => check.startsWith("alice:")).length,
      bob: checks.filter((check) => check.startsWith("bob:")).length,
    }).toStrictEqual({ alice: 8, bob: 8 });
  });

  it("returns identical capabilities on repeated requests", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({}, { mutations: true }),
    });
    const expectedBody = {
      readOnly: false,
      actions: {
        read: true,
        cancel: true,
        cancelBulk: true,
        retry: true,
        retryBulk: true,
        reschedule: true,
        setJobPriority: false,
        delete: true,
        deleteBulk: true,
        pause: false,
        resume: false,
      },
    };

    const first = await handleManagementGet(surface, "/api/v1/capabilities");
    const second = await handleManagementGet(surface, "/api/v1/capabilities");

    await expectJsonResponse(first, 200, expectedBody);
    await expectJsonResponse(second, 200, expectedBody);
  });

  it("uses adapter-provided request context for action authorization", async () => {
    const authorizedActions = new Set(["read", "retry"]);
    const surface = createManagementSurface<{ role: string }>({
      monque: createManagementMonque({}, { mutations: true }),
      authorize: ({ action, context }) => {
        expect(context).toStrictEqual({ role: "viewer" });
        return authorizedActions.has(action);
      },
    });

    const response = await handleManagementGet(surface, "/api/v1/capabilities", {
      managementContext: { role: "viewer" },
    });

    await expectJsonResponse(response, 200, {
      readOnly: false,
      actions: {
        read: true,
        cancel: false,
        cancelBulk: false,
        retry: true,
        retryBulk: false,
        reschedule: false,
        setJobPriority: false,
        delete: false,
        deleteBulk: false,
        pause: false,
        resume: false,
      },
    });
  });

  it("does not require managementContext when no hooks need it", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({}, { mutations: true }),
    });

    const result = await surface.openApiHandler.handle(
      new Request("https://management.example/api/v1/capabilities"),
      {},
    );

    if (!result.matched) {
      throw new Error("Expected oRPC OpenAPI handler to match capabilities route");
    }

    await expectJsonResponse(result.response, 200, {
      readOnly: false,
      actions: {
        read: true,
        cancel: true,
        cancelBulk: true,
        retry: true,
        retryBulk: true,
        reschedule: true,
        setJobPriority: false,
        delete: true,
        deleteBulk: true,
        pause: false,
        resume: false,
      },
    });
  });

  it("returns a clear handler error when managementContext is missing", async () => {
    const surface = createManagementSurface<{ role: string }>({
      monque: createManagementMonque({}, { mutations: true }),
      authorize: () => true,
    });

    const result = await surface.openApiHandler.handle(
      new Request("https://management.example/api/v1/capabilities"),
      {},
    );

    if (!result.matched) {
      throw new Error("Expected oRPC OpenAPI handler to match capabilities route");
    }

    await expectJsonResponse(result.response, 500, {
      error:
        "Missing managementContext in openApiHandler.handle() context; managementContext is required for authorize/serializePayload hooks.",
    });
  });

  it("reports writable actions unavailable in read-only mode", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({}, { mutations: true }),
      readOnly: true,
    });

    const response = await handleManagementGet(surface, "/api/v1/capabilities");

    await expectJsonResponse(response, 200, {
      readOnly: true,
      actions: {
        read: true,
        cancel: false,
        cancelBulk: false,
        retry: false,
        retryBulk: false,
        reschedule: false,
        setJobPriority: false,
        delete: false,
        deleteBulk: false,
        pause: false,
        resume: false,
      },
    });
  });

  it("keeps unsupported actions visible as unavailable capabilities", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({
        retryJob: vi.fn<NonNullable<ManagementMonque["retryJob"]>>().mockResolvedValue(null),
        retryJobs: vi
          .fn<NonNullable<ManagementMonque["retryJobs"]>>()
          .mockResolvedValue({ count: 0, errors: [] }),
      }),
    });

    const response = await handleManagementGet(surface, "/api/v1/capabilities");

    await expectJsonResponse(response, 200, {
      readOnly: false,
      actions: {
        read: true,
        cancel: false,
        cancelBulk: false,
        retry: true,
        retryBulk: true,
        reschedule: false,
        setJobPriority: false,
        delete: false,
        deleteBulk: false,
        pause: false,
        resume: false,
      },
    });
  });

  it("keeps action capabilities separate from route-level scheduler support", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({
        cancelJobs: vi
          .fn<NonNullable<ManagementMonque["cancelJobs"]>>()
          .mockResolvedValue({ count: 0, errors: [] }),
      }),
    });

    const capabilities = await handleManagementGet(surface, "/api/v1/capabilities");
    const singleCancel = await handleManagementPost(
      surface,
      "/api/v1/jobs/507f1f77bcf86cd799439011/actions/cancel",
    );
    const bulkCancel = await handleManagementPost(surface, "/api/v1/jobs/actions/cancel", {});

    const actions: unknown = expect.objectContaining({ cancel: false, cancelBulk: true });
    await expectJsonResponse(capabilities, 200, expect.objectContaining({ actions }));
    await expectJsonResponse(singleCancel, 403, { error: "Unsupported action" });
    await expectJsonResponse(bulkCancel, 200, { count: 0, errors: [] });
  });

  it.each([
    {
      path: "/api/v1/jobs/507f1f77bcf86cd799439011/actions/cancel",
      body: undefined,
      error: "Management surface is read-only",
    },
    {
      path: "/api/v1/jobs/actions/cancel",
      body: {},
      error: "Management surface is read-only",
    },
    {
      path: "/api/v1/jobs/actions/selected",
      body: { action: "cancel", ids: ["507f1f77bcf86cd799439011"] },
      error: "Unsupported action",
    },
    {
      path: "/api/v1/processing/actions/pause",
      body: { instanceId: "unsupported" },
      error: "Unsupported action",
    },
  ])(
    "preserves denial precedence for $path before resolving targets",
    async ({ path, body, error }) => {
      const authorize = vi.fn<() => boolean>(() => true);
      const getJob = vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(null);
      const surface = createManagementSurface({
        monque: createManagementMonque({ getJob }),
        readOnly: true,
        authorize,
      });

      await expectJsonResponse(await handleManagementPost(surface, path, body), 403, { error });
      expect(authorize).not.toHaveBeenCalled();
      expect(getJob).not.toHaveBeenCalled();
    },
  );
});
