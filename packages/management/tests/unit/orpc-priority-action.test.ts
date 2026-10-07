import { JobStateError } from "@monque/core";
import { ObjectId } from "mongodb";
import { describe, expect, test } from "vite-plus/test";

import { createManagementSurface, generateManagementOpenApiDocument } from "@/index";
import {
  createManagementJob,
  createManagementMonque,
  expectJsonResponse,
  getManagementJobById,
  handleManagementGet,
  handleManagementPost,
} from "@tests/unit/management-test-utils";

describe("single Job priority action", () => {
  test("sets signed priority with target authorization and payload serialization", async () => {
    const target = createManagementJob({ _id: new ObjectId(), priority: 0 });
    const coreCalls: unknown[] = [];
    const authorization: unknown[] = [];
    const surface = createManagementSurface<{ user: string }>({
      monque: createManagementMonque({
        getJob: getManagementJobById(target),
        setJobPriority: async (id, priority) => {
          coreCalls.push({ id, priority });
          return { ...target, priority };
        },
      }),
      authorize: ({ action, context, job }) => {
        authorization.push({ action, context, job });
        return true;
      },
      serializePayload: async () => ({ redacted: true }),
    });
    await expectJsonResponse(
      await handleManagementPost(
        surface,
        `/api/v1/jobs/${target._id}/actions/priority`,
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
    expect(coreCalls).toEqual([{ id: target._id.toHexString(), priority: -7 }]);
    expect(authorization).toEqual([
      { action: "setJobPriority", context: { user: "operator" }, job: target },
    ]);
  });
  test.each([
    {},
    { priority: null },
    { priority: "2" },
    { priority: true },
    { priority: 0.5 },
    { priority: 9007199254740992 },
    { priority: 1, extra: true },
  ])("rejects malformed body %j before authorization or mutation", async (body) => {
    let called = false;
    const surface = createManagementSurface({
      monque: createManagementMonque({
        setJobPriority: async () => {
          called = true;
          return null;
        },
      }),
      authorize: () => {
        called = true;
        return true;
      },
    });
    const response = await handleManagementPost(
      surface,
      `/api/v1/jobs/${new ObjectId()}/actions/priority`,
      body,
    );
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  test.each(["missing", "lost", "state"] as const)("maps %s core outcomes", async (outcome) => {
    const target = createManagementJob();
    const surface = createManagementSurface({
      monque: createManagementMonque({
        getJob: outcome === "missing" ? async () => null : getManagementJobById(target),
        setJobPriority: async () => {
          if (outcome === "state")
            throw new JobStateError(
              "Job was claimed",
              target._id.toHexString(),
              "processing",
              "setJobPriority",
            );
          return null;
        },
      }),
    });
    expect(
      (
        await handleManagementPost(surface, `/api/v1/jobs/${target._id}/actions/priority`, {
          priority: 3,
        })
      ).status,
    ).toBe(outcome === "state" ? 409 : 404);
  });

  test.each(["unsupported", "readonly", "denied", "allowed"] as const)(
    "enforces %s policy in discovery and mutation",
    async (policy) => {
      const target = createManagementJob();
      let mutated = false;
      const surface = createManagementSurface<{ allowed: boolean }>({
        monque: createManagementMonque({
          getJob: getManagementJobById(target),
          ...(policy === "unsupported"
            ? {}
            : {
                setJobPriority: async (_id: string, priority: number) => {
                  mutated = true;
                  return { ...target, priority };
                },
              }),
        }),
        readOnly: policy === "readonly",
        authorize: ({ action, context }) =>
          action !== "setJobPriority" || (policy !== "denied" && context.allowed),
      });
      for (const allowed of [false, true]) {
        const context = { managementContext: { allowed } };
        const expected = allowed && policy === "allowed";
        const capabilities = await handleManagementGet(surface, "/api/v1/capabilities", context);
        expect(await capabilities.json()).toMatchObject({ actions: { setJobPriority: expected } });
        const response = await handleManagementPost(
          surface,
          `/api/v1/jobs/${target._id}/actions/priority`,
          { priority: 3 },
          context,
        );
        expect(response.status).toBe(expected ? 200 : 403);
        expect(mutated).toBe(expected);
      }
    },
  );

  test("publishes reusable signed-safe-integer request schema and status responses in OpenAPI", async () => {
    const document = await generateManagementOpenApiDocument();
    const route = document.paths?.["/api/v1/jobs/{id}/actions/priority"]?.post;
    expect(route?.operationId).toBe("setJobPriority");
    expect(route?.responses).toHaveProperty("400");
    expect(route?.responses).toHaveProperty("403");
    expect(route?.responses).toHaveProperty("404");
    expect(route?.responses).toHaveProperty("409");
    expect(document.components?.schemas?.["SetJobPriorityRequest"]).toMatchObject({
      properties: {
        priority: { type: "integer", minimum: -9007199254740991, maximum: 9007199254740991 },
      },
      required: ["priority"],
      additionalProperties: false,
    });
  });
  test("rejects oversized priority request bodies before authorization", async () => {
    let authorized = false;
    const surface = createManagementSurface({
      monque: createManagementMonque(),
      authorize: () => {
        authorized = true;
        return true;
      },
    });
    const request = new Request(
      `https://management.example/api/v1/jobs/${new ObjectId()}/actions/priority`,
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
