import { JobStateError } from "@monque/core";
import { ObjectId } from "mongodb";
import { vi, describe, expect, it } from "vite-plus/test";

import { createManagementSurface, generateManagementOpenApiDocument } from "@/index";
import type { ManagementMonque } from "@/surface";
import {
  createManagementJob,
  createManagementMonque,
  expectJsonResponse,
  getManagementJobById,
  handleManagementGet,
  handleManagementPost,
} from "@tests/unit/management-test-utils";

describe("single Job priority action", () => {
  it("sets signed priority with target authorization and payload serialization", async () => {
    const target = createManagementJob({ _id: new ObjectId(), priority: 0 });
    const coreCalls: unknown[] = [];
    const authorization: unknown[] = [];
    const surface = createManagementSurface<{ user: string }>({
      monque: createManagementMonque({
        getJob: getManagementJobById(target),
        setJobPriority: async (id, priority) => {
          coreCalls.push({ id, priority });
          return await Promise.resolve({ ...target, priority });
        },
      }),
      authorize: ({ action, context, job }) => {
        authorization.push({ action, context, job });
        return true;
      },
      serializePayload: async () => await Promise.resolve({ redacted: true }),
    });
    await expectJsonResponse(
      await handleManagementPost(
        surface,
        `/api/v1/jobs/${target._id.toHexString()}/actions/priority`,
        { priority: -7 },
        { managementContext: { user: "operator" } },
      ),
      200,
      expect.objectContaining({
        id: target._id.toHexString(),
        priority: -7,
        payload: { redacted: true },
      }),
    );
    expect(coreCalls).toStrictEqual([{ id: target._id.toHexString(), priority: -7 }]);
    expect(authorization).toStrictEqual([
      { action: "setJobPriority", context: { user: "operator" }, job: target },
    ]);
  });

  it.each([
    {},
    { priority: null },
    { priority: "2" },
    { priority: true },
    { priority: 0.5 },
    { priority: 9_007_199_254_740_992 },
    { priority: 1, extra: true },
  ])("rejects malformed body %j before authorization or mutation", async (body) => {
    let called = false;
    const surface = createManagementSurface({
      monque: createManagementMonque({
        setJobPriority: async () => {
          called = true;
          return await Promise.resolve(null);
        },
      }),
      authorize: () => {
        called = true;
        return true;
      },
    });
    const response = await handleManagementPost(
      surface,
      `/api/v1/jobs/${new ObjectId().toHexString()}/actions/priority`,
      body,
    );
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  it.each(["missing", "lost", "state"] as const)("maps %s core outcomes", async (outcome) => {
    const target = createManagementJob();
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getJob:
          outcome === "missing"
            ? async () => await Promise.resolve(null)
            : getManagementJobById(target),
        setJobPriority: async () => {
          if (outcome === "state") {
            return await vi
              .fn<() => Promise<never>>()
              .mockRejectedValue(
                new JobStateError(
                  "Job was claimed",
                  target._id.toHexString(),
                  "processing",
                  "setJobPriority",
                ),
              )();
          }
          return await Promise.resolve(null);
        },
      }),
    });
    const response1 = await handleManagementPost(
      surface,
      `/api/v1/jobs/${target._id.toHexString()}/actions/priority`,
      {
        priority: 3,
      },
    );
    expect(response1.status).toBe(outcome === "state" ? 409 : 404);
  });

  it.each(
    (["unsupported", "readonly", "denied", "allowed"] as const).flatMap((policy) =>
      [false, true].map((allowed) => ({ policy, allowed })),
    ),
  )(
    "enforces $policy policy in discovery and mutation when allowed=$allowed",
    async ({ policy, allowed }) => {
      const target = createManagementJob();
      let mutated = false;
      const methods: Partial<ManagementMonque> = { getJob: getManagementJobById(target) };
      if (policy !== "unsupported") {
        methods.setJobPriority = async (_id, priority) => {
          mutated = true;
          return await Promise.resolve({ ...target, priority });
        };
      }
      const surface = createManagementSurface<{ allowed: boolean }>({
        monque: createManagementMonque(methods),
        readOnly: policy === "readonly",
        authorize: ({ action, context }) =>
          action !== "setJobPriority" || (policy !== "denied" && context.allowed),
      });

      const context = { managementContext: { allowed } };
      const expected = allowed && policy === "allowed";
      const capabilities = await handleManagementGet(surface, "/api/v1/capabilities", context);
      await expect(capabilities.json()).resolves.toMatchObject({
        actions: { setJobPriority: expected },
      });
      const response = await handleManagementPost(
        surface,
        `/api/v1/jobs/${target._id.toHexString()}/actions/priority`,
        { priority: 3 },
        context,
      );
      expect(response.status).toBe(expected ? 200 : 403);
      expect(mutated).toBe(expected);
    },
  );

  it("publishes reusable signed-safe-integer request schema and status responses in OpenAPI", async () => {
    const document = await generateManagementOpenApiDocument();
    const route = document.paths?.["/api/v1/jobs/{id}/actions/priority"]?.post;
    expect(route?.operationId).toBe("setJobPriority");
    expect(Object.keys(route?.responses ?? {})).toStrictEqual(
      expect.arrayContaining(["400", "403", "404", "409"]),
    );
    expect(document.components?.schemas?.["SetJobPriorityRequest"]).toMatchObject({
      properties: {
        priority: {
          type: "integer",
          minimum: -9_007_199_254_740_991,
          maximum: 9_007_199_254_740_991,
        },
      },
      required: ["priority"],
      additionalProperties: false,
    });
  });

  it("rejects oversized priority request bodies before authorization", async () => {
    let authorized = false;
    const surface = createManagementSurface({
      monque: createManagementMonque(),
      authorize: () => {
        authorized = true;
        return true;
      },
    });
    const request = new Request(
      `https://management.example/api/v1/jobs/${new ObjectId().toHexString()}/actions/priority`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priority: 1, padding: "x".repeat(70_000) }),
      },
    );
    const result = await surface.openApiHandler.handle(request, {
      context: { managementContext: {} },
    });
    expect(result.response?.status).toBe(413);
    expect(authorized).toBe(false);
  });
});
