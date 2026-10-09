import { JobStateError } from "@monque/core";
import { ObjectId } from "mongodb";
import { vi, describe, expect, it } from "vite-plus/test";

import { createManagementSurface } from "@/index";
import type { ManagementMonque } from "@/surface";
import {
  createManagementJob,
  createManagementMonque,
  expectJsonResponse,
  getManagementJobById,
  handleManagementDelete,
  handleManagementPost,
} from "@tests/unit/management-test-utils";

describe("oRPC Management single Job action routes", () => {
  it("cancels one Job through public core API with target authorization", async () => {
    const jobId = new ObjectId();
    const target = createManagementJob({
      _id: jobId,
      repeatInterval: "0 9 * * *",
      timezone: "Europe/Berlin",
    });
    const cancelled = createManagementJob({
      ...target,
      _id: jobId,
      status: "cancelled",
      updatedAt: new Date("2026-01-01T00:02:00.000Z"),
    });
    const coreCalls: string[] = [];
    const authorizeCalls: unknown[] = [];
    const surface = createManagementSurface<{ userId: string }>({
      monque: createManagementMonque({
        getJob: getManagementJobById(target),
        cancelJob: async (id) => {
          coreCalls.push(id);

          return await Promise.resolve(cancelled);
        },
      }),
      authorize: ({ action, context, job }) => {
        authorizeCalls.push({ action, context, job });
        return true;
      },
    });

    const response = await handleManagementPost(
      surface,
      `/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
      undefined,
      { managementContext: { userId: "operator-1" } },
    );

    await expectJsonResponse(response, 200, {
      id: jobId.toHexString(),
      name: "send-email",
      status: "cancelled",
      priority: 0,
      payload: { to: "person@example.test" },
      nextRunAt: "2026-01-01T00:00:00.000Z",
      lockedAt: null,
      claimedBy: null,
      lastHeartbeat: null,
      failCount: 0,
      failureReason: null,
      repeatInterval: "0 9 * * *",
      timezone: "Europe/Berlin",
      createdAt: "2025-12-31T23:00:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    });
    expect(coreCalls).toStrictEqual([jobId.toHexString()]);
    expect(authorizeCalls).toStrictEqual([
      {
        action: "cancel",
        context: { userId: "operator-1" },
        job: target,
      },
    ]);
  });

  it.each([1, 2])(
    "manually retries a failed Job with %i failures through public core API",
    async (failCount) => {
      const jobId = new ObjectId();
      const target = createManagementJob({
        _id: jobId,
        status: "failed",
        failCount,
        failReason: "Account no longer exists",
        updatedAt: new Date("2026-01-01T00:02:00.000Z"),
      });
      const retried = createManagementJob({
        _id: jobId,
        status: "pending",
        failCount: 0,
        updatedAt: new Date("2026-01-01T00:03:00.000Z"),
      });
      const coreCalls: string[] = [];
      const surface = createManagementSurface({
        monque: createManagementMonque({
          getJob: getManagementJobById(target),
          retryJob: async (id) => {
            coreCalls.push(id);

            return await Promise.resolve(retried);
          },
        }),
      });

      const response = await handleManagementPost(
        surface,
        `/api/v1/jobs/${jobId.toHexString()}/actions/retry`,
      );

      await expectJsonResponse(
        response,
        200,
        expect.objectContaining({
          id: jobId.toHexString(),
          status: "pending",
          failCount: 0,
          updatedAt: "2026-01-01T00:03:00.000Z",
        }),
      );
      expect(coreCalls).toStrictEqual([jobId.toHexString()]);
    },
  );

  it("maps a single Job mutation miss after target resolution to 404", async () => {
    const jobId = new ObjectId();
    const target = createManagementJob({ _id: jobId, status: "failed" });
    const coreCalls: string[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getJob: getManagementJobById(target),
        retryJob: async (id) => {
          coreCalls.push(id);

          return await Promise.resolve(null);
        },
      }),
    });

    const response = await handleManagementPost(
      surface,
      `/api/v1/jobs/${jobId.toHexString()}/actions/retry`,
    );

    await expectJsonResponse(response, 404, { error: "Job not found" });
    expect(coreCalls).toStrictEqual([jobId.toHexString()]);
  });

  it("deletes one Job through public core API with a stable response DTO", async () => {
    const jobId = new ObjectId();
    const target = createManagementJob({ _id: jobId, status: "completed" });
    const coreCalls: string[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getJob: getManagementJobById(target),
        deleteJob: async (id) => {
          coreCalls.push(id);

          return await Promise.resolve(true);
        },
      }),
    });

    const response = await handleManagementDelete(surface, `/api/v1/jobs/${jobId.toHexString()}`);

    await expectJsonResponse(response, 200, { deleted: true });
    expect(coreCalls).toStrictEqual([jobId.toHexString()]);
  });

  it("keeps single Job delete idempotent when repeated after deletion", async () => {
    const jobId = new ObjectId();
    const target = createManagementJob({ _id: jobId, status: "completed" });
    const coreCalls: string[] = [];
    let deleted = false;
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getJob: async (id) => {
          if (deleted) {
            return null;
          }

          return await getManagementJobById(target)(id);
        },
        deleteJob: async (id) => {
          coreCalls.push(id);
          deleted = true;

          return await Promise.resolve(true);
        },
      }),
    });

    const first = await handleManagementDelete(surface, `/api/v1/jobs/${jobId.toHexString()}`);
    const second = await handleManagementDelete(surface, `/api/v1/jobs/${jobId.toHexString()}`);

    await expectJsonResponse(first, 200, { deleted: true });
    await expectJsonResponse(second, 404, { error: "Job not found" });
    expect(coreCalls).toStrictEqual([jobId.toHexString()]);
  });

  it("maps a single Job delete miss after target resolution to 404", async () => {
    const jobId = new ObjectId();
    const target = createManagementJob({ _id: jobId, status: "completed" });
    const coreCalls: string[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getJob: getManagementJobById(target),
        deleteJob: async (id) => {
          coreCalls.push(id);

          return await Promise.resolve(false);
        },
      }),
    });

    const response = await handleManagementDelete(surface, `/api/v1/jobs/${jobId.toHexString()}`);

    await expectJsonResponse(response, 404, { error: "Job not found" });
    expect(coreCalls).toStrictEqual([jobId.toHexString()]);
  });

  it("reschedules one Job with an ISO date DTO mapped to core Date", async () => {
    const jobId = new ObjectId();
    const target = createManagementJob({ _id: jobId });
    const rescheduled = createManagementJob({
      _id: jobId,
      nextRunAt: new Date("2026-02-01T10:30:00.000Z"),
      updatedAt: new Date("2026-01-01T00:04:00.000Z"),
    });
    const coreCalls: { id: string; runAt: Date }[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getJob: getManagementJobById(target),
        rescheduleJob: async (id, runAt) => {
          coreCalls.push({ id, runAt });

          return await Promise.resolve(rescheduled);
        },
      }),
    });

    const response = await handleManagementPost(
      surface,
      `/api/v1/jobs/${jobId.toHexString()}/actions/reschedule`,
      { nextRunAt: "2026-02-01T10:30:00.000Z" },
    );

    await expectJsonResponse(
      response,
      200,
      expect.objectContaining({
        id: jobId.toHexString(),
        nextRunAt: "2026-02-01T10:30:00.000Z",
        updatedAt: "2026-01-01T00:04:00.000Z",
      }),
    );
    expect(coreCalls).toStrictEqual([
      {
        id: jobId.toHexString(),
        runAt: new Date("2026-02-01T10:30:00.000Z"),
      },
    ]);
  });

  it("maps single Job action failures to stable HTTP statuses", async () => {
    const jobId = new ObjectId();
    const target = createManagementJob({ _id: jobId });
    const coreCalls: string[] = [];
    const readOnly = createManagementSurface({
      monque: createManagementMonque({
        cancelJob: async () => {
          coreCalls.push("read-only");

          return await Promise.resolve(null);
        },
      }),
      readOnly: true,
    });
    const unsupported = createManagementSurface({
      monque: createManagementMonque(),
    });
    const denied = createManagementSurface<{ role: string }>({
      monque: createManagementMonque({
        getJob: getManagementJobById(target),
        cancelJob: async () => {
          coreCalls.push("denied");

          return await Promise.resolve(null);
        },
      }),
      authorize: ({ action, context, job }) => {
        expect({ action, context, job }).toStrictEqual({
          action: "cancel",
          context: { role: "viewer" },
          job: target,
        });

        return false;
      },
    });
    const validatesBeforeCore = createManagementSurface({
      monque: createManagementMonque({
        getJob: async () => {
          coreCalls.push("invalid");

          return await Promise.resolve(target);
        },
        cancelJob: async () => {
          coreCalls.push("invalid");

          return await Promise.resolve(target);
        },
        rescheduleJob: async () => {
          coreCalls.push("invalid");

          return await Promise.resolve(target);
        },
      }),
    });
    const missing = createManagementSurface({
      monque: createManagementMonque({
        getJob: vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(null),
        cancelJob: async () => {
          coreCalls.push("missing");

          return await Promise.resolve(null);
        },
      }),
    });
    const conflict = createManagementSurface({
      monque: createManagementMonque({
        getJob: getManagementJobById(target),
        cancelJob: async () =>
          await vi
            .fn<() => Promise<never>>()
            .mockRejectedValue(
              new JobStateError(
                "Cannot cancel processing job",
                jobId.toHexString(),
                "processing",
                "cancel",
              ),
            )(),
      }),
    });

    const readOnlyResponse = await handleManagementPost(
      readOnly,
      `/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
    );
    const unsupportedResponse = await handleManagementPost(
      unsupported,
      `/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
    );
    const deniedResponse = await handleManagementPost(
      denied,
      `/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
      undefined,
      { managementContext: { role: "viewer" } },
    );
    const invalidId = await handleManagementPost(
      validatesBeforeCore,
      "/api/v1/jobs/not-an-object-id/actions/cancel",
    );
    const invalidRescheduleBody = await handleManagementPost(
      validatesBeforeCore,
      `/api/v1/jobs/${jobId.toHexString()}/actions/reschedule`,
      { nextRunAt: "February 1, 2026 10:30:00" },
    );
    const missingResponse = await handleManagementPost(
      missing,
      `/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
    );
    const conflictResponse = await handleManagementPost(
      conflict,
      `/api/v1/jobs/${jobId.toHexString()}/actions/cancel`,
    );

    await expectJsonResponse(readOnlyResponse, 403, { error: "Management surface is read-only" });
    await expectJsonResponse(unsupportedResponse, 403, { error: "Unsupported action" });
    await expectJsonResponse(deniedResponse, 403, { error: "Action denied" });
    await expectJsonResponse(invalidId, 400, { error: "Invalid job id" });
    await expectJsonResponse(invalidRescheduleBody, 400, {
      error: "Input validation failed",
    });
    await expectJsonResponse(missingResponse, 404, { error: "Job not found" });
    await expectJsonResponse(conflictResponse, 409, { error: "Cannot cancel processing job" });
    expect(coreCalls).toStrictEqual([]);
  });
});
