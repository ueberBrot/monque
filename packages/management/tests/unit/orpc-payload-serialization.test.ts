import { vi, describe, expect, it } from "vite-plus/test";

import { createManagementSurface } from "@/index";
import type { ManagementOptions, ManagementPayloadSerializer } from "@/index";
import type { ManagementMonque } from "@/surface";
import {
  createManagementJob,
  createManagementMonque,
  expectJsonResponse,
  getManagementJobById,
  handleManagementGet,
  handleManagementPost,
} from "@tests/unit/management-test-utils";

describe("oRPC Management payload serialization", () => {
  describe.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "Job Name %s",
    (name) => {
      it.each(["list", "detail", "cancel", "retry", "reschedule"])(
        "redacts the %s response without exposing request context",
        async (route) => {
          const job = createManagementJob({ name, data: { token: "payload-secret" } });
          const surface = createManagementSurface<{ token: string }>({
            monque: createManagementMonque({
              getJobsWithCursor: vi
                .fn<NonNullable<ManagementMonque["getJobsWithCursor"]>>()
                .mockResolvedValue({
                  jobs: [job],
                  cursor: null,
                  hasNextPage: false,
                  hasPreviousPage: false,
                }),
              getJob: getManagementJobById(job),
              cancelJob: vi
                .fn<NonNullable<ManagementMonque["cancelJob"]>>()
                .mockResolvedValue({ ...job, status: "cancelled" }),
              retryJob: vi
                .fn<NonNullable<ManagementMonque["retryJob"]>>()
                .mockResolvedValue({ ...job, status: "pending" }),
              rescheduleJob: async (_id, nextRunAt) => await Promise.resolve({ ...job, nextRunAt }),
            }),
            serializePayload: async () => await Promise.resolve({ redacted: true }),
            serializePayloadByJobName: {},
          });
          const context = { managementContext: { token: "context-secret" } };
          const jobPath = `/api/v1/jobs/${job._id.toHexString()}`;
          const response =
            route === "list" || route === "detail"
              ? await handleManagementGet(
                  surface,
                  route === "list" ? "/api/v1/jobs" : jobPath,
                  context,
                )
              : await handleManagementPost(
                  surface,
                  `${jobPath}/actions/${route}`,
                  route === "reschedule" ? { nextRunAt: "2026-02-01T00:00:00.000Z" } : undefined,
                  context,
                );

          const expectedJob: unknown = expect.objectContaining({
            name,
            payload: { redacted: true },
          });
          await expectJsonResponse(
            response,
            200,
            route === "list"
              ? { jobs: [expectedJob], cursor: null, hasNextPage: false, hasPreviousPage: false }
              : expectedJob,
          );
        },
      );

      it("returns only the original payload when no serializer is configured", async () => {
        const job = createManagementJob({ name, data: { visible: true } });
        const surface = createManagementSurface({
          monque: createManagementMonque({ getJob: getManagementJobById(job) }),
          serializePayloadByJobName: {},
        });

        const response = await handleManagementGet(
          surface,
          `/api/v1/jobs/${job._id.toHexString()}`,
          {
            managementContext: { token: "context-secret" },
          },
        );

        await expectJsonResponse(
          response,
          200,
          expect.objectContaining({ name, payload: { visible: true } }),
        );
      });

      it("uses an explicit serializer in a null-prototype map", async () => {
        const job = createManagementJob({ name, data: { token: "payload-secret" } });
        const serializers = {
          [name]: async () => await Promise.resolve({ source: "job" }),
        } satisfies Record<string, ManagementPayloadSerializer>;
        Object.setPrototypeOf(serializers, null);
        const surface = createManagementSurface({
          monque: createManagementMonque({ getJob: getManagementJobById(job) }),
          serializePayload: async () => await Promise.resolve({ source: "global" }),
          serializePayloadByJobName: serializers,
        });

        const response = await handleManagementGet(
          surface,
          `/api/v1/jobs/${job._id.toHexString()}`,
        );

        await expectJsonResponse(
          response,
          200,
          expect.objectContaining({ name, payload: { source: "job" } }),
        );
      });
    },
  );

  it("ignores custom inherited serializers and falls back to the global serializer", async () => {
    const job = createManagementJob({ data: { token: "payload-secret" } });
    const serializers: Record<string, ManagementPayloadSerializer> = {};
    Object.setPrototypeOf(serializers, {
      "send-email": async () => await Promise.resolve({ source: "inherited" }),
    });
    const surface = createManagementSurface({
      monque: createManagementMonque({ getJob: getManagementJobById(job) }),
      serializePayload: async () => await Promise.resolve({ source: "global" }),
      serializePayloadByJobName: serializers,
    });

    const response = await handleManagementGet(surface, `/api/v1/jobs/${job._id.toHexString()}`);

    await expectJsonResponse(
      response,
      200,
      expect.objectContaining({ payload: { source: "global" } }),
    );
  });

  it.each([undefined, null])("falls back for an own serializer value of %s", async (value) => {
    const job = createManagementJob();
    const serializers: Record<string, ManagementPayloadSerializer> = {};
    Object.defineProperty(serializers, job.name, { value });
    const surface = createManagementSurface({
      monque: createManagementMonque({ getJob: getManagementJobById(job) }),
      serializePayload: async () => await Promise.resolve({ source: "global" }),
      serializePayloadByJobName: serializers,
    });

    await expectJsonResponse(
      await handleManagementGet(surface, `/api/v1/jobs/${job._id.toHexString()}`),
      200,
      expect.objectContaining({ payload: { source: "global" } }),
    );
  });

  it.each([
    Promise.resolve({ visible: true }),
    {
      // oxlint-disable-next-line unicorn/no-thenable -- This payload deliberately tests Promise assimilation.
      then: (resolve: (payload: { visible: boolean }) => void) => {
        resolve({ visible: true });
      },
    },
  ])("awaits raw payloads without a serializer", async (data) => {
    const job = createManagementJob({ data });
    const surface = createManagementSurface({
      monque: createManagementMonque({ getJob: getManagementJobById(job) }),
    });

    await expectJsonResponse(
      await handleManagementGet(surface, `/api/v1/jobs/${job._id.toHexString()}`),
      200,
      expect.objectContaining({ payload: { visible: true } }),
    );
  });

  it("captures metadata before reading live serializer options and invokes hooks without a receiver", async () => {
    const job = createManagementJob();
    const context = { role: "admin" };
    const options: ManagementOptions<typeof context> = {
      monque: createManagementMonque({ getJob: getManagementJobById(job) }),
      serializePayload: async () => await Promise.resolve({ source: "initial" }),
    };
    const surface = createManagementSurface(options);
    Object.defineProperty(options, "serializePayloadByJobName", {
      get: () => {
        job.updatedAt = new Date("2026-02-01T00:00:00.000Z");
        return {};
      },
    });
    options.serializePayload = async function serializePayload(this: undefined, input) {
      expect(this).toBeUndefined();
      expect(input.job).toBe(job);
      expect(input.payload).toBe(job.data);
      expect(input.context).toBe(context);
      job.name = "renamed";
      return await Promise.resolve({ source: "live" });
    };

    await expectJsonResponse(
      await handleManagementGet(surface, `/api/v1/jobs/${job._id.toHexString()}`, {
        managementContext: context,
      }),
      200,
      expect.objectContaining({
        name: "send-email",
        updatedAt: "2026-01-01T00:01:00.000Z",
        payload: { source: "live" },
      }),
    );
  });
});
