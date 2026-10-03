import { InvalidCursorError } from "@monque/core";
import { createRouterClient, ORPCError } from "@orpc/server";
import { describe, expect, test } from "vite-plus/test";

import { createManagementRouter, createManagementSurface } from "@/index";
import {
  createManagementJob,
  createManagementMonque,
  expectJsonResponse,
  handleManagementGet,
  handleManagementPost,
} from "@tests/unit/management-test-utils";

describe("management Effect compatibility", () => {
  describe.each(["authorization", "facade", "serializer"] as const)("%s failures", (seam) => {
    test.each([undefined, null, "External failure", { reason: "External failure" }])(
      "preserves an arbitrary rejection value %j",
      async (failure) => {
        const job = createManagementJob();
        const client = createRouterClient(
          createManagementRouter({
            monque: createManagementMonque({
              getJob: () => (seam === "facade" ? Promise.reject(failure) : Promise.resolve(job)),
            }),
            authorize: () => (seam === "authorization" ? Promise.reject(failure) : true),
            serializePayload: ({ payload }) =>
              seam === "serializer" ? Promise.reject(failure) : Promise.resolve(payload),
          }),
          { context: { managementContext: {} } },
        );

        await expect(client.job({ params: { id: job._id.toHexString() } })).rejects.toBe(failure);
      },
    );

    test.each([undefined, null, "External failure", { reason: "External failure" }])(
      "preserves an arbitrary synchronous failure %j",
      async (failure) => {
        const job = createManagementJob();
        const client = createRouterClient(
          createManagementRouter({
            monque: createManagementMonque({
              getJob: () => {
                if (seam === "facade") throw failure;
                return Promise.resolve(job);
              },
            }),
            authorize: () => {
              if (seam === "authorization") throw failure;
              return true;
            },
            serializePayload: ({ payload }) => {
              if (seam === "serializer") throw failure;
              return Promise.resolve(payload);
            },
          }),
          { context: { managementContext: {} } },
        );

        await expect(client.job({ params: { id: job._id.toHexString() } })).rejects.toBe(failure);
      },
    );
  });

  test("starts every parallel authorization check and returns failures without waiting for the others", async () => {
    const gate = Promise.withResolvers<void>();
    const checks: string[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({}, { mutations: true }),
      parallelCapabilityChecks: true,
      authorize: ({ action }) => {
        checks.push(action);
        if (action === "read") throw new ORPCError("FORBIDDEN", { message: "Access revoked" });
        return gate.promise.then(() => true);
      },
    });
    try {
      await expectJsonResponse(await handleManagementGet(surface, "/api/v1/capabilities"), 403, {
        error: "Access revoked",
      });
      expect(checks).toEqual([
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

  test("preserves original authorization failures for direct oRPC consumers", async () => {
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

  test.each(["synchronous", "Promise"])(
    "preserves original %s serializer failures for direct oRPC consumers",
    async (mode) => {
      const job = createManagementJob();
      const failure = new Error("Serializer failed");
      const options = {
        monque: createManagementMonque({ getJob: async () => job }),
        serializePayload: () => {
          if (mode === "synchronous") throw failure;
          return Promise.reject(failure);
        },
      };
      const client = createRouterClient(createManagementRouter(options), {
        context: { managementContext: {} },
      });

      await expect(client.job({ params: { id: job._id.toHexString() } })).rejects.toBe(failure);
    },
  );

  test("maps cursor failures from facade Job metadata to bad requests", async () => {
    const job = createManagementJob();
    Object.defineProperty(job, "updatedAt", {
      get: () => {
        throw new InvalidCursorError("Cursor metadata unavailable");
      },
    });
    const client = createRouterClient(
      createManagementRouter({
        monque: createManagementMonque({
          getJobsWithCursor: async () => ({
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

  test.each(["jobs", "cursor", "hasNextPage", "hasPreviousPage"])(
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
          monque: createManagementMonque({ getJobsWithCursor: async () => page }),
        }),
        { context: { managementContext: {} } },
      );

      await expect(client.jobs({})).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Cursor page unavailable",
      });
    },
  );

  test("starts every page serializer and rejects without waiting for pending serializers", async () => {
    const jobs = [
      createManagementJob({ name: "pending-first" }),
      createManagementJob({ name: "failing" }),
      createManagementJob({ name: "pending-last" }),
    ];
    const failure = new Error("Serializer failed");
    const gate = Promise.withResolvers<void>();
    const serialized: string[] = [];
    const client = createRouterClient(
      createManagementRouter({
        monque: createManagementMonque({
          getJobsWithCursor: async () => ({
            jobs,
            cursor: null,
            hasNextPage: false,
            hasPreviousPage: false,
          }),
        }),
        serializePayload: ({ job, payload }) => {
          serialized.push(job.name);
          if (job.name === "failing") throw failure;
          return gate.promise.then(() => payload);
        },
      }),
      { context: { managementContext: {} } },
    );

    try {
      await expect(client.jobs({})).rejects.toBe(failure);
      expect(serialized).toEqual(["pending-first", "failing", "pending-last"]);
    } finally {
      gate.resolve();
    }
  });

  test("observes pending serializer completion and rejection after the page has already failed", async () => {
    const jobs = [
      createManagementJob({ name: "failing" }),
      createManagementJob({ name: "pending" }),
    ];
    const failure = new Error("First serializer failed");
    const laterFailure = new Error("Pending serializer failed later");
    const gate = Promise.withResolvers<void>();
    const completed = Promise.withResolvers<void>();
    const client = createRouterClient(
      createManagementRouter({
        monque: createManagementMonque({
          getJobsWithCursor: async () => ({
            jobs,
            cursor: null,
            hasNextPage: false,
            hasPreviousPage: false,
          }),
        }),
        serializePayload: ({ job }) => {
          if (job.name === "failing") throw failure;
          return gate.promise.then(() => {
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

  test("reports selected action facade errors independently for every job", async () => {
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

  test.each([undefined, null, "External failure", { reason: "External failure" }])(
    "isolates arbitrary selected action facade failures %j while other jobs succeed",
    async (failure) => {
      const jobs = [createManagementJob(), createManagementJob()];
      const monque = createManagementMonque(
        {
          getJob: async (id) => jobs.find((job) => job._id.toHexString() === id) ?? null,
        },
        { mutations: true },
      );
      let reads = 0;
      Object.defineProperty(monque, "deleteJob", {
        get: () => {
          if (reads++ === 0) throw failure;
          return () => Promise.resolve(true);
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
