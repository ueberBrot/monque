import type { BulkOperationResult, JobSelector } from "@monque/core";
import { JobStateError } from "@monque/core";
import { describe, expect, test } from "vite-plus/test";

import { createManagementSurface } from "@/index";
import {
  createManagementJob,
  createManagementMonque,
  expectJsonResponse,
  handleManagementGet,
  handleManagementPost,
} from "@tests/unit/management-test-utils";

describe("oRPC Management bulk action routes", () => {
  test("changes one shared priority only for unique selected pending Jobs", async () => {
    const selected = createManagementJob({ priority: 3 });
    const other = createManagementJob({ priority: 7 });
    const jobs = [selected, other];
    const changes: Array<{ id: string; priority: number }> = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getJob: async (id) => jobs.find((job) => job._id.toHexString() === id) ?? null,
        setJobPriority: async (id, priority) => {
          changes.push({ id, priority });
          const job = jobs.find((job) => job._id.toHexString() === id);
          if (!job) return null;
          job.priority = priority;
          return job;
        },
      }),
    });
    const id = selected._id.toHexString();
    const response = await handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
      action: "priority",
      ids: [id, id.toUpperCase(), id],
      priority: -12,
    });

    await expectJsonResponse(response, 200, { count: 1, errors: [] });
    expect(changes).toEqual([{ id, priority: -12 }]);
    const selectedRead = await handleManagementGet(surface, `/api/v1/jobs/${id}`);
    expect(await selectedRead.json()).toMatchObject({ priority: -12 });
    const otherRead = await handleManagementGet(surface, `/api/v1/jobs/${other._id}`);
    expect(await otherRead.json()).toMatchObject({ priority: 7 });
  });

  test("starts waiting selected jobs as soon as a worker finishes while another job is slow", async () => {
    const jobs = Array.from({ length: 8 }, () => createManagementJob({ status: "failed" }));
    const ids = jobs.map((job) => job._id.toHexString());
    const slow = Promise.withResolvers<void>();
    const started: string[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque(
        {
          getJob: async (id) => jobs.find((job) => job._id.toHexString() === id) ?? null,
          retryJob: async (id) => {
            started.push(id);
            if (id === ids[0]) await slow.promise;
            return createManagementJob({ status: "pending" });
          },
        },
        { mutations: true },
      ),
    });
    const request = handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
      action: "retry",
      ids,
    });
    try {
      await expect.poll(() => started.length, { timeout: 200 }).toBe(8);
    } finally {
      slow.resolve();
      await request;
    }
    expect(await (await request).json()).toMatchObject({ count: 8, errors: [] });
  });

  test("selected actions authorize each job and report partial failures without touching other jobs", async () => {
    const allowed = createManagementJob({ status: "failed" });
    const denied = createManagementJob({ status: "failed" });
    const changed: string[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque(
        {
          getJob: async (id) =>
            [allowed, denied].find((job) => job._id.toHexString() === id) ?? null,
          retryJob: async (id) => {
            changed.push(id);
            return { ...allowed, status: "pending" };
          },
        },
        { mutations: true },
      ),
      authorize: ({ job, ids }) => {
        if (ids) expect(ids).toEqual([allowed._id.toHexString(), denied._id.toHexString()]);
        return !job || job._id.equals(allowed._id);
      },
      serializePayload: () => {
        throw new Error("Bulk actions do not return payloads");
      },
    });
    const response = await handleManagementPost(
      surface,
      "/api/v1/jobs/actions/selected",
      {
        action: "retry",
        ids: [allowed._id.toHexString(), denied._id.toHexString(), allowed._id.toHexString()],
      },
      { managementContext: {} },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      count: 1,
      errors: [{ jobId: denied._id.toHexString(), status: 403 }],
    });
    expect(changed).toEqual([allowed._id.toHexString()]);
  });

  test.each(["cancel", "retry", "delete", "reschedule", "priority"] as const)(
    "selected %s is bounded and reports missing jobs independently",
    async (action) => {
      const jobs = Array.from({ length: 12 }, () => createManagementJob());
      let active = 0;
      let maximum = 0;
      const changed: string[] = [];
      const mutate = async (id: string) => {
        active++;
        maximum = Math.max(active, maximum);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        changed.push(id);
        return createManagementJob();
      };
      const surface = createManagementSurface({
        monque: createManagementMonque(
          {
            getJob: async (id) => jobs.find((job) => job._id.toHexString() === id) ?? null,
            cancelJob: mutate,
            retryJob: mutate,
            rescheduleJob: mutate,
            setJobPriority: mutate,
            deleteJob: async (id) => {
              await mutate(id);
              return true;
            },
          },
          { mutations: true },
        ),
      });
      const missing = createManagementJob()._id.toHexString();
      const response = await handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
        action,
        ids: [...jobs.map((job) => job._id.toHexString()), missing],
        ...(action === "reschedule" ? { nextRunAt: "2027-01-01T00:00:00.000Z" } : {}),
        ...(action === "priority" ? { priority: 8 } : {}),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        count: 12,
        errors: [{ jobId: missing, status: 404 }],
      });
      expect(maximum).toBe(5);
      expect(changed).toHaveLength(12);
    },
  );

  test("selected priority preserves independent forbidden, missing, terminal and claim-race outcomes", async () => {
    const allowed = createManagementJob({ priority: 1 });
    const denied = createManagementJob({ priority: 2 });
    const raced = createManagementJob({ priority: 3 });
    const removed = createManagementJob({ priority: 4 });
    const untouched = createManagementJob({ priority: 5 });
    const nonpending = (["processing", "completed", "failed", "cancelled"] as const).map((status) =>
      createManagementJob({ status, priority: 6 }),
    );
    const jobs = [allowed, denied, raced, removed, untouched, ...nonpending];
    const missing = createManagementJob()._id.toHexString();
    const selected = [allowed, denied, raced, removed, ...nonpending].map((job) =>
      job._id.toHexString(),
    );
    const ids = [...selected, missing];
    const authorization: unknown[] = [];
    const changed: string[] = [];
    const surface = createManagementSurface<{ user: string }>({
      monque: createManagementMonque({
        getJob: async (id) => jobs.find((job) => job._id.toHexString() === id) ?? null,
        setJobPriority: async (id, priority) => {
          const job = jobs.find((job) => job._id.toHexString() === id);
          if (!job || job === removed) return null;
          if (job === raced) job.status = "processing";
          if (job.status !== "pending") {
            throw new JobStateError("Job is no longer pending", id, job.status, "setJobPriority");
          }
          changed.push(id);
          job.priority = priority;
          return job;
        },
      }),
      authorize: ({ action, context, job, ids: targetIds }) => {
        authorization.push({ action, context, id: job?._id.toHexString(), ids: targetIds });
        return action === "read" || job !== denied;
      },
    });
    const response = await handleManagementPost(
      surface,
      "/api/v1/jobs/actions/selected",
      {
        action: "priority",
        ids,
        priority: 42,
      },
      { managementContext: { user: "operator" } },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      count: 1,
      errors: expect.arrayContaining([
        expect.objectContaining({ jobId: denied._id.toHexString(), status: 403 }),
        expect.objectContaining({ jobId: missing, status: 404 }),
        expect.objectContaining({ jobId: removed._id.toHexString(), status: 404 }),
        ...[raced, ...nonpending].map((job) =>
          expect.objectContaining({ jobId: job._id.toHexString(), status: 409 }),
        ),
      ]),
    });
    expect(body).toHaveProperty("errors.length", 8);
    expect(changed).toEqual([allowed._id.toHexString()]);
    expect(authorization).toEqual([
      { action: "setJobPriority", context: { user: "operator" }, id: undefined, ids },
      ...selected.map((id) => ({
        action: "setJobPriority",
        context: { user: "operator" },
        id,
        ids: undefined,
      })),
    ]);
    const expectedPriorities = [42, 2, 3, 4, 5, 6, 6, 6, 6];
    for (const [index, job] of jobs.entries()) {
      const response = await handleManagementGet(surface, `/api/v1/jobs/${job._id}`, {
        managementContext: { user: "operator" },
      });
      expect(await response.json()).toMatchObject({ priority: expectedPriorities[index] });
    }
  });

  test.each([undefined, null, "3", true, 0.5, 9007199254740992, -9007199254740992])(
    "rejects selected priority %j before authorization or job access",
    async (priority) => {
      let accessed = false;
      const surface = createManagementSurface({
        monque: createManagementMonque({
          getJob: async () => {
            accessed = true;
            return null;
          },
          setJobPriority: async () => {
            accessed = true;
            return null;
          },
        }),
        authorize: () => {
          accessed = true;
          return true;
        },
      });
      const response = await handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
        action: "priority",
        ids: [createManagementJob()._id.toHexString()],
        priority,
      });
      expect(response.status).toBe(400);
      expect(accessed).toBe(false);
    },
  );

  test("validates the raw selection limit and rejects extra scope before mutation", async () => {
    const target = createManagementJob({ priority: 0 });
    let changes = 0;
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getJob: async () => target,
        setJobPriority: async (_id, priority) => {
          changes++;
          return { ...target, priority };
        },
      }),
    });
    for (const body of [
      { ids: [] },
      { ids: Array.from({ length: 101 }, () => target._id.toHexString()) },
      { ids: [target._id.toHexString()], name: target.name },
      { ids: [target._id.toHexString()], cursor: "other-page" },
      { ids: [target._id.toHexString()], selector: { status: "pending" } },
      { ids: [target._id.toHexString(), null] },
    ]) {
      const response = await handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
        action: "priority",
        priority: 0,
        ...body,
      });
      expect(response.status).toBe(400);
    }
    expect(changes).toBe(0);
    for (const priority of [Number.MIN_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER]) {
      await expectJsonResponse(
        await handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
          action: "priority",
          priority,
          ids: Array.from({ length: 100 }, () => target._id.toHexString()),
        }),
        200,
        { count: 1, errors: [] },
      );
    }
    expect(changes).toBe(3);
  });

  test.each(["unsupported", "readonly", "denied", "allowed"] as const)(
    "selected priority enforces %s capability before accessing Jobs",
    async (policy) => {
      const target = createManagementJob();
      let accessed = false;
      const surface = createManagementSurface<{ allowed: boolean }>({
        monque: createManagementMonque({
          getJob: async () => {
            accessed = true;
            return target;
          },
          ...(policy === "unsupported" ? {} : { setJobPriority: async () => target }),
        }),
        readOnly: policy === "readonly",
        authorize: ({ action, context }) =>
          action !== "setJobPriority" || (policy !== "denied" && context.allowed),
      });
      for (const allowed of [false, true]) {
        accessed = false;
        const context = { managementContext: { allowed } };
        const expected = policy === "allowed" && allowed;
        const discovery = await handleManagementGet(surface, "/api/v1/capabilities", context);
        expect(await discovery.json()).toMatchObject({ actions: { setJobPriority: expected } });
        const response = await handleManagementPost(
          surface,
          "/api/v1/jobs/actions/selected",
          {
            action: "priority",
            priority: 4,
            ids: [target._id.toHexString()],
          },
          context,
        );
        expect(response.status).toBe(expected ? 200 : 403);
        expect(accessed).toBe(expected);
      }
    },
  );

  test.each(["origin", "body"] as const)(
    "selected priority retains %s protection before authorization and mutations",
    async (protection) => {
      let accessed = false;
      const target = createManagementJob();
      const surface = createManagementSurface({
        monque: createManagementMonque({
          getJob: async () => {
            accessed = true;
            return target;
          },
          setJobPriority: async () => {
            accessed = true;
            return target;
          },
        }),
        authorize: () => {
          accessed = true;
          return true;
        },
      });
      const result = await surface.openApiHandler.handle(
        new Request("https://management.example/api/v1/jobs/actions/selected", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(protection === "origin" ? { origin: "https://attacker.example" } : {}),
          },
          body: JSON.stringify({
            action: "priority",
            ids: [target._id.toHexString()],
            priority: 1,
            ...(protection === "body" ? { padding: "x".repeat(70_000) } : {}),
          }),
        }),
        { context: { managementContext: {} } },
      );
      expect(result.response?.status).toBe(protection === "origin" ? 403 : 413);
      expect(accessed).toBe(false);
    },
  );

  test("rejects oversized selections and read-only mutations before touching jobs", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({}, { mutations: true }),
      readOnly: true,
    });
    const id = createManagementJob()._id.toHexString();
    const oversized = await handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
      action: "retry",
      ids: Array.from({ length: 101 }, () => id),
    });
    expect(oversized.status).toBe(400);
    const denied = await handleManagementPost(surface, "/api/v1/jobs/actions/selected", {
      action: "retry",
      ids: [id],
    });
    expect(denied.status).toBe(403);
  });

  test("bulk cancels Jobs through public core API with selector DTOs", async () => {
    const coreCalls: JobSelector[] = [];
    const authorizeCalls: unknown[] = [];
    const surface = createManagementSurface<{ userId: string }>({
      monque: createManagementMonque({
        cancelJobs: async (selector): Promise<BulkOperationResult> => {
          coreCalls.push(selector);

          return {
            count: 2,
            errors: [],
          };
        },
      }),
      authorize: ({ action, context, selector }) => {
        authorizeCalls.push({ action, context, selector });
        return true;
      },
    });

    const response = await handleManagementPost(
      surface,
      "/api/v1/jobs/actions/cancel",
      {
        name: "send-email",
        status: ["pending"],
        olderThan: "2026-02-01T10:30:00.000Z",
        newerThan: "2026-01-01T00:00:00.000Z",
      },
      { managementContext: { userId: "operator-1" } },
    );

    const expectedSelector = {
      name: "send-email",
      status: ["pending"],
      olderThan: new Date("2026-02-01T10:30:00.000Z"),
      newerThan: new Date("2026-01-01T00:00:00.000Z"),
    };
    await expectJsonResponse(response, 200, {
      count: 2,
      errors: [],
    });
    expect(coreCalls).toEqual([expectedSelector]);
    expect(authorizeCalls).toEqual([
      {
        action: "cancelBulk",
        context: { userId: "operator-1" },
        selector: expectedSelector,
      },
    ]);
  });

  test("bulk retries and deletes Jobs through public core APIs with stable result DTOs", async () => {
    const coreCalls: Array<{ action: string; selector: JobSelector }> = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({
        retryJobs: async (selector): Promise<BulkOperationResult> => {
          coreCalls.push({ action: "retry", selector });

          return {
            count: 1,
            errors: [{ jobId: "job-1", error: "still processing" }],
          };
        },
        deleteJobs: async (selector): Promise<BulkOperationResult> => {
          coreCalls.push({ action: "delete", selector });

          return {
            count: 3,
            errors: [],
          };
        },
      }),
    });

    const retry = await handleManagementPost(surface, "/api/v1/jobs/actions/retry", {
      status: "failed",
    });
    const deleted = await handleManagementPost(surface, "/api/v1/jobs/actions/delete", {
      status: ["completed", "cancelled"],
    });

    await expectJsonResponse(retry, 200, {
      count: 1,
      errors: [{ jobId: "job-1", error: "still processing" }],
    });
    await expectJsonResponse(deleted, 200, {
      count: 3,
      errors: [],
    });
    expect(coreCalls).toEqual([
      { action: "retry", selector: { status: "failed" } },
      { action: "delete", selector: { status: ["completed", "cancelled"] } },
    ]);
  });

  test("passes an empty bulk Job selector through to public core APIs", async () => {
    const coreCalls: JobSelector[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({
        deleteJobs: async (selector): Promise<BulkOperationResult> => {
          coreCalls.push(selector);

          return { count: 0, errors: [] };
        },
      }),
    });

    const response = await handleManagementPost(surface, "/api/v1/jobs/actions/delete", {});

    await expectJsonResponse(response, 200, { count: 0, errors: [] });
    expect(coreCalls).toEqual([{}]);
  });

  test("rejects read-only, unsupported, and denied bulk actions with 403", async () => {
    const coreCalls: string[] = [];
    const readOnly = createManagementSurface({
      monque: createManagementMonque({
        cancelJobs: async (): Promise<BulkOperationResult> => {
          coreCalls.push("read-only");

          return { count: 0, errors: [] };
        },
      }),
      readOnly: true,
    });
    const unsupported = createManagementSurface({
      monque: createManagementMonque(),
    });
    const denied = createManagementSurface<{ role: string }>({
      monque: createManagementMonque({
        cancelJobs: async (): Promise<BulkOperationResult> => {
          coreCalls.push("denied");

          return { count: 0, errors: [] };
        },
      }),
      authorize: ({ action, context, selector }) => {
        expect({ action, context, selector }).toEqual({
          action: "cancelBulk",
          context: { role: "viewer" },
          selector: { name: "send-email" },
        });

        return false;
      },
    });

    const readOnlyResponse = await handleManagementPost(
      readOnly,
      "/api/v1/jobs/actions/cancel",
      {},
    );
    const unsupportedResponse = await handleManagementPost(
      unsupported,
      "/api/v1/jobs/actions/cancel",
      {},
    );
    const deniedResponse = await handleManagementPost(
      denied,
      "/api/v1/jobs/actions/cancel",
      { name: "send-email" },
      { managementContext: { role: "viewer" } },
    );

    await expectJsonResponse(readOnlyResponse, 403, { error: "Management surface is read-only" });
    await expectJsonResponse(unsupportedResponse, 403, { error: "Unsupported action" });
    await expectJsonResponse(deniedResponse, 403, { error: "Action denied" });
    expect(coreCalls).toEqual([]);
  });

  test("rejects invalid bulk selector request shapes before calling core", async () => {
    const coreCalls: string[] = [];
    const surface = createManagementSurface({
      monque: createManagementMonque({
        cancelJobs: async (): Promise<BulkOperationResult> => {
          coreCalls.push("called");

          return { count: 0, errors: [] };
        },
      }),
    });

    const invalidShape = await handleManagementPost(surface, "/api/v1/jobs/actions/cancel", []);
    const invalidStatus = await handleManagementPost(surface, "/api/v1/jobs/actions/cancel", {
      status: [],
    });
    const invalidDate = await handleManagementPost(surface, "/api/v1/jobs/actions/cancel", {
      olderThan: "February 1, 2026 10:30:00",
    });
    const unknownSelectorField = await handleManagementPost(
      surface,
      "/api/v1/jobs/actions/cancel",
      {
        olderThen: "2026-02-01T10:30:00.000Z",
      },
    );

    for (const response of [invalidShape, invalidStatus, invalidDate, unknownSelectorField]) {
      await expectJsonResponse(response, 400, { error: "Input validation failed" });
    }
    expect(coreCalls).toEqual([]);
  });

  test("maps invalid bulk Job state transitions to 409", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({
        cancelJobs: async () => {
          throw new JobStateError("Cannot cancel selected jobs", "bulk", "processing", "cancel");
        },
      }),
    });

    const response = await handleManagementPost(surface, "/api/v1/jobs/actions/cancel", {
      status: "processing",
    });

    await expectJsonResponse(response, 409, { error: "Cannot cancel selected jobs" });
  });

  test("maps unexpected bulk action failures to the documented 500 response", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({
        cancelJobs: async () => {
          throw new Error("Database unavailable");
        },
      }),
    });

    const response = await handleManagementPost(surface, "/api/v1/jobs/actions/cancel", {});

    await expectJsonResponse(response, 500, { error: "Internal server error" });
  });
});
