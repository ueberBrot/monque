import { InvalidCursorError } from "@monque/core";
import { createRouterClient, ORPCError } from "@orpc/server";
import { vi, describe, expect, it } from "vite-plus/test";

import { createManagementRouter, createManagementSurface } from "@/index";
import type { ManagementMonque } from "@/surface";
import {
  createManagementJob,
  createManagementMonque,
  expectJsonResponse,
  handleManagementGet,
  handleManagementPost,
} from "@tests/unit/management-test-utils";

describe("management Effect compatibility", () => {
  describe.each(["authorization", "facade", "serializer"] as const)("%s failures", (seam) => {
    it.each([undefined, null, "External failure", { reason: "External failure" }])(
      "preserves an arbitrary rejection value %j",
      async (failure) => {
        const job = createManagementJob();
        const rejectFailure = vi.fn<() => Promise<never>>().mockRejectedValue(failure);
        const client = createRouterClient(
          createManagementRouter({
            monque: createManagementMonque({
              getJob: async () =>
                seam === "facade" ? await rejectFailure() : await Promise.resolve(job),
            }),
            authorize: seam === "authorization" ? rejectFailure : () => true,
            serializePayload: async ({ payload }) =>
              seam === "serializer" ? await rejectFailure() : await Promise.resolve(payload),
          }),
          { context: { managementContext: {} } },
        );

        await expect(client.job({ params: { id: job._id.toHexString() } })).rejects.toBe(failure);
      },
    );

    it.each([undefined, null, "External failure", { reason: "External failure" }])(
      "preserves an arbitrary synchronous failure %j",
      async (failure) => {
        const job = createManagementJob();
        const client = createRouterClient(
          createManagementRouter({
            monque: createManagementMonque({
              // oxlint-disable-next-line typescript/promise-function-async -- This fixture must throw synchronously before returning a Promise.
              getJob: () => {
                if (seam === "facade") {
                  // oxlint-disable-next-line typescript/only-throw-error -- Exercise the adapter's arbitrary synchronous failure contract.
                  throw failure;
                }
                // oxlint-disable-next-line unicorn/no-useless-promise-resolve-reject -- The facade's success contract returns a native Promise.
                return Promise.resolve(job);
              },
            }),
            authorize: () => {
              if (seam === "authorization") {
                // oxlint-disable-next-line typescript/only-throw-error -- Exercise the adapter's arbitrary synchronous failure contract.
                throw failure;
              }
              return true;
            },
            // oxlint-disable-next-line typescript/promise-function-async -- This fixture must throw synchronously before returning a Promise.
            serializePayload: ({ payload }) => {
              if (seam === "serializer") {
                // oxlint-disable-next-line typescript/only-throw-error -- Exercise the adapter's arbitrary synchronous failure contract.
                throw failure;
              }
              // oxlint-disable-next-line unicorn/no-useless-promise-resolve-reject -- The serializer's success contract returns a native Promise.
              return Promise.resolve(payload);
            },
          }),
          { context: { managementContext: {} } },
        );

        await expect(client.job({ params: { id: job._id.toHexString() } })).rejects.toBe(failure);
      },
    );
  });

  it("starts every parallel authorization check and returns failures without waiting for the others", async () => {
    const gate: PromiseWithResolvers<void> = Promise.withResolvers();
    const checks: string[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({}, { mutations: true }),
      parallelCapabilityChecks: true,
      authorize: async ({ action }) => {
        checks.push(action);
        if (action === "read") {
          throw new ORPCError("FORBIDDEN", { message: "Access revoked" });
        }
        await gate.promise;
        return true;
      },
    });
    try {
      await expectJsonResponse(await handleManagementGet(surface, "/api/v1/capabilities"), 403, {
        error: "Access revoked",
      });
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
    } finally {
      gate.resolve();
    }
  });

  it("preserves original authorization failures for direct oRPC consumers", async () => {
    const failure = new ORPCError("FORBIDDEN", { message: "Access revoked" });
    const client = createRouterClient(
      createManagementRouter({
        monque: createManagementMonque(),
        authorize: () => {
          throw failure;
        },
      }),
      { context: { managementContext: {} } },
    );

    await expect(client.jobs({})).rejects.toBe(failure);
  });

  it.each(["synchronous", "Promise"])(
    "preserves original %s serializer failures for direct oRPC consumers",
    async (mode) => {
      const job = createManagementJob();
      const failure = new Error("Serializer failed");
      const options = {
        monque: createManagementMonque({
          getJob: vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(job),
        }),
        // oxlint-disable-next-line typescript/promise-function-async -- Compare synchronous throws with asynchronous Promise rejections.
        serializePayload: () => {
          if (mode === "synchronous") {
            throw failure;
          }
          return vi.fn<() => Promise<never>>().mockRejectedValue(failure)();
        },
      };
      const client = createRouterClient(createManagementRouter(options), {
        context: { managementContext: {} },
      });

      await expect(client.job({ params: { id: job._id.toHexString() } })).rejects.toBe(failure);
    },
  );

  it("maps cursor failures from facade Job metadata to bad requests", async () => {
    const job = createManagementJob();
    Object.defineProperty(job, "updatedAt", {
      get: () => {
        throw new InvalidCursorError("Cursor metadata unavailable");
      },
    });
    const client = createRouterClient(
      createManagementRouter({
        monque: createManagementMonque({
          getJobsWithCursor: vi
            .fn<NonNullable<ManagementMonque["getJobsWithCursor"]>>()
            .mockResolvedValue({
              jobs: [job],
              cursor: null,
              hasNextPage: false,
              hasPreviousPage: false,
            }),
        }),
      }),
      { context: { managementContext: {} } },
    );

    await expect(client.jobs({})).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cursor metadata unavailable",
    });
  });

  it.each(["jobs", "cursor", "hasNextPage", "hasPreviousPage"])(
    "maps cursor failures from the page's %s property to bad requests",
    async (property) => {
      const page = {
        jobs: [createManagementJob()],
        cursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
      };
      Object.defineProperty(page, property, {
        get: () => {
          throw new InvalidCursorError("Cursor page unavailable");
        },
      });
      const client = createRouterClient(
        createManagementRouter({
          monque: createManagementMonque({
            getJobsWithCursor: vi
              .fn<NonNullable<ManagementMonque["getJobsWithCursor"]>>()
              .mockResolvedValue(page),
          }),
        }),
        { context: { managementContext: {} } },
      );

      await expect(client.jobs({})).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Cursor page unavailable",
      });
    },
  );

  it("starts every page serializer and rejects without waiting for pending serializers", async () => {
    const jobs = [
      createManagementJob({ name: "pending-first" }),
      createManagementJob({ name: "failing" }),
      createManagementJob({ name: "pending-last" }),
    ];
    const failure = new Error("Serializer failed");
    const gate: PromiseWithResolvers<void> = Promise.withResolvers();
    const serialized: string[] = [];
    const client = createRouterClient(
      createManagementRouter({
        monque: createManagementMonque({
          getJobsWithCursor: vi
            .fn<NonNullable<ManagementMonque["getJobsWithCursor"]>>()
            .mockResolvedValue({
              jobs,
              cursor: null,
              hasNextPage: false,
              hasPreviousPage: false,
            }),
        }),
        serializePayload: async ({ job, payload }) => {
          serialized.push(job.name);
          if (job.name === "failing") {
            throw failure;
          }
          return await gate.promise.then(() => payload);
        },
      }),
      { context: { managementContext: {} } },
    );

    try {
      await expect(client.jobs({})).rejects.toBe(failure);
      expect(serialized).toStrictEqual(["pending-first", "failing", "pending-last"]);
    } finally {
      gate.resolve();
    }
  });

  it("observes pending serializer completion and rejection after the page has already failed", async () => {
    const jobs = [
      createManagementJob({ name: "failing" }),
      createManagementJob({ name: "pending" }),
    ];
    const failure = new Error("First serializer failed");
    const laterFailure = new Error("Pending serializer failed later");
    const gate: PromiseWithResolvers<void> = Promise.withResolvers();
    const completed: PromiseWithResolvers<void> = Promise.withResolvers();
    const client = createRouterClient(
      createManagementRouter({
        monque: createManagementMonque({
          getJobsWithCursor: vi
            .fn<NonNullable<ManagementMonque["getJobsWithCursor"]>>()
            .mockResolvedValue({
              jobs,
              cursor: null,
              hasNextPage: false,
              hasPreviousPage: false,
            }),
        }),
        serializePayload: async ({ job }) => {
          if (job.name === "failing") {
            throw failure;
          }
          return await gate.promise.then(() => {
            completed.resolve();
            throw laterFailure;
          });
        },
      }),
      { context: { managementContext: {} } },
    );

    try {
      await expect(client.jobs({})).rejects.toBe(failure);
    } finally {
      gate.resolve();
      await completed.promise;
    }
  });

  it("reports selected action facade errors independently for every job", async () => {
    const jobs = [createManagementJob(), createManagementJob()];
    const monque = createManagementMonque({}, { mutations: true });
    Object.defineProperty(monque, "deleteJob", {
      get: () => {
        throw new ORPCError("CONFLICT", { message: "Facade unavailable" });
      },
    });
    const surface = createManagementSurface({ monque });
    const ids = jobs.map((job) => job._id.toHexString());

    await expectJsonResponse(
      await handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
        action: "delete",
        ids,
      }),
      200,
      {
        count: 0,
        errors: ids.map((jobId) => ({ jobId, status: 409, error: "Facade unavailable" })),
      },
    );
  });

  it.each([undefined, null, "External failure", { reason: "External failure" }])(
    "isolates arbitrary selected action facade failures %j while other jobs succeed",
    async (failure) => {
      const jobs = [createManagementJob(), createManagementJob()];
      const monque = createManagementMonque(
        {
          getJob: async (id) =>
            await Promise.resolve(jobs.find((job) => job._id.toHexString() === id) ?? null),
        },
        { mutations: true },
      );
      let reads = 0;
      Object.defineProperty(monque, "deleteJob", {
        get: () => {
          const previousReads = reads;
          reads += 1;
          if (previousReads === 0) {
            // oxlint-disable-next-line typescript/only-throw-error -- Exercise the adapter's arbitrary synchronous getter failure contract.
            throw failure;
          }
          return async () => await Promise.resolve(true);
        },
      });
      const surface = createManagementSurface({ monque });
      const ids = jobs.map((job) => job._id.toHexString());

      await expectJsonResponse(
        await handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
          action: "delete",
          ids,
        }),
        200,
        {
          count: 1,
          errors: [{ jobId: ids[0], status: 500, error: "Job action failed" }],
        },
      );
    },
  );
});
