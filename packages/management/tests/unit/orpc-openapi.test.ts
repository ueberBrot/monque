import { beforeAll, describe, expect, it } from "vite-plus/test";

import { generateManagementOpenApiDocument } from "@/index";

describe("oRPC Management OpenAPI contract", () => {
  let document: Awaited<ReturnType<typeof generateManagementOpenApiDocument>>;

  beforeAll(async () => {
    document = await generateManagementOpenApiDocument();
  });

  it("includes stable reusable schema names", () => {
    expect(Object.keys(document.components?.schemas ?? {})).toStrictEqual(
      expect.arrayContaining([
        "BulkActionResult",
        "Capabilities",
        "DeleteJob",
        "Job",
        "JobCursorPage",
        "JobSelector",
        "ManagementError",
        "QueueStats",
        "QueueViewSummaryList",
        "RescheduleJobRequest",
        "SchedulerHealth",
      ]),
    );
  });

  it("publishes stable document metadata", () => {
    expect(document.info.title).toBe("Monque Management API");
    expect(document.info.version).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/u);
  });

  it("publishes effective priority as required signed safe integer Job metadata", () => {
    const required: unknown = expect.arrayContaining(["priority"]);
    expect(document.components?.schemas?.["Job"]).toMatchObject({
      properties: {
        priority: {
          type: "integer",
          minimum: -9_007_199_254_740_991,
          maximum: 9_007_199_254_740_991,
        },
      },
      required,
    });
  });

  it("publishes selected priority input limits and per-Job outcome responses", () => {
    const route = document.paths?.["/api/v1/jobs/actions/selected"]?.post;
    const priority: unknown = expect.objectContaining({
      type: "integer",
      minimum: -9_007_199_254_740_991,
      maximum: 9_007_199_254_740_991,
    });
    const anyOf: unknown = expect.arrayContaining([
      expect.objectContaining({
        properties: {
          action: { const: "priority" },
          ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
          priority,
        },
        required: ["action", "ids", "priority"],
        additionalProperties: false,
      }),
    ]);
    expect(route).toMatchObject({
      operationId: "selectedJobActions",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              anyOf,
            },
          },
        },
      },
      responses: {
        "200": {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/BulkActionResult" } },
          },
        },
      },
    });
    expect(route?.responses).toHaveProperty("400");
    expect(route?.responses).toHaveProperty("403");
  });

  it("publishes schedule timezone as optional Job metadata", () => {
    const job = document.components?.schemas?.["Job"];
    expect(job).toMatchObject({ properties: { timezone: { type: "string" } } });
    if (!job || !("required" in job)) {
      throw new Error("Expected the Job object schema");
    }
    expect(job.required).not.toContain("timezone");
  });

  it("derives the health path and response schema from the oRPC contract", () => {
    expect(document.openapi).toBe("3.1.1");
    expect(document.paths?.["/api/v1/health"]?.get?.operationId).toBe("getSchedulerHealth");
    expect(document.paths?.["/api/v1/health"]?.get?.responses?.["200"]).toMatchObject({
      description: "Successful response",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SchedulerHealth" },
        },
      },
    });
    expect(document.components?.schemas?.["SchedulerHealth"]).toMatchObject({
      type: "object",
      properties: {
        status: {
          enum: ["ok", "unavailable"],
          type: "string",
        },
        scheduler: {
          type: "object",
          properties: {
            healthy: { type: "boolean" },
          },
          required: ["healthy"],
          additionalProperties: false,
        },
      },
      required: ["status", "scheduler"],
      additionalProperties: false,
    });
  });

  it("derives the capabilities path and response schema from the oRPC contract", () => {
    expect(document.paths?.["/api/v1/capabilities"]?.get?.operationId).toBe("getCapabilities");
    expect(document.paths?.["/api/v1/capabilities"]?.get?.responses?.["200"]).toMatchObject({
      description: "Successful response",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Capabilities" },
        },
      },
    });
    expect(document.components?.schemas?.["Capabilities"]).toMatchObject({
      type: "object",
      properties: {
        readOnly: { type: "boolean" },
        actions: {
          type: "object",
          properties: {
            read: { type: "boolean" },
            cancel: { type: "boolean" },
            cancelBulk: { type: "boolean" },
            retry: { type: "boolean" },
            retryBulk: { type: "boolean" },
            reschedule: { type: "boolean" },
            delete: { type: "boolean" },
            deleteBulk: { type: "boolean" },
          },
          required: [
            "read",
            "cancel",
            "cancelBulk",
            "retry",
            "retryBulk",
            "reschedule",
            "delete",
            "deleteBulk",
          ],
          additionalProperties: false,
        },
      },
      required: ["readOnly", "actions"],
      additionalProperties: false,
    });
  });

  it("derives Queue View and Job stats paths from the oRPC contract - 1", () => {
    expect(document.paths?.["/api/v1/queue-views"]?.get?.operationId).toBe("listQueueViews");
    expect(document.paths?.["/api/v1/queue-views"]?.get?.responses?.["200"]).toMatchObject({
      description: "Successful response",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/QueueViewSummaryList" },
        },
      },
    });
    expect(document.paths?.["/api/v1/jobs/stats"]?.get?.operationId).toBe("getJobStats");
    expect(document.paths?.["/api/v1/jobs/stats"]?.get?.parameters).toStrictEqual([
      expect.objectContaining({
        name: "name",
        in: "query",
        schema: { type: "string", minLength: 1 },
      }),
    ]);
    expect(document.paths?.["/api/v1/jobs/stats"]?.get?.responses?.["200"]).toMatchObject({
      description: "Successful response",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/QueueStats" },
        },
      },
    });
  });

  it("derives Queue View and Job stats paths from the oRPC contract - 2", () => {
    expect(document.components?.schemas?.["QueueViewSummaryList"]).toMatchObject({
      type: "object",
      required: ["queueViews"],
      additionalProperties: false,
    });
    expect(document.components?.schemas?.["QueueStats"]).toMatchObject({
      type: "object",
      required: ["pending", "processing", "completed", "failed", "cancelled", "total"],
      additionalProperties: false,
    });
  });

  it("derives Job list and detail paths from the oRPC contract - 1", () => {
    expect(document.paths?.["/api/v1/jobs"]?.get?.operationId).toBe("listJobs");
    expect(document.paths?.["/api/v1/jobs"]?.get?.parameters).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "cursor",
          in: "query",
          schema: { type: "string" },
        }),
        expect.objectContaining({
          name: "limit",
          in: "query",
          schema: { type: "string" },
        }),
        expect.objectContaining({
          name: "name",
          in: "query",
          schema: { type: "string", minLength: 1 },
        }),
        expect.objectContaining({
          name: "status",
          in: "query",
          explode: true,
        }),
        expect.objectContaining({
          name: "createdAtFrom",
          in: "query",
          schema: { type: "string", format: "date-time" },
        }),
        expect.objectContaining({
          name: "createdAtTo",
          in: "query",
          schema: { type: "string", format: "date-time" },
        }),
        expect.objectContaining({
          name: "updatedAtFrom",
          in: "query",
          schema: { type: "string", format: "date-time" },
        }),
        expect.objectContaining({
          name: "updatedAtTo",
          in: "query",
          schema: { type: "string", format: "date-time" },
        }),
        expect.objectContaining({
          name: "nextRunAtFrom",
          in: "query",
          schema: { type: "string", format: "date-time" },
        }),
        expect.objectContaining({
          name: "nextRunAtTo",
          in: "query",
          schema: { type: "string", format: "date-time" },
        }),
        expect.objectContaining({
          name: "sortBy",
          in: "query",
          schema: {
            type: "string",
            enum: ["identifier", "createdAt", "updatedAt", "nextRunAt"],
          },
        }),
        expect.objectContaining({
          name: "sortDirection",
          in: "query",
          schema: {
            type: "string",
            enum: ["asc", "desc"],
          },
        }),
      ]),
    );
    expect(document.paths?.["/api/v1/jobs"]?.get?.responses?.["200"]).toMatchObject({
      description: "Successful response",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/JobCursorPage" },
        },
      },
    });
    expect(document.paths?.["/api/v1/jobs/{id}"]?.get?.operationId).toBe("getJob");
    expect(document.paths?.["/api/v1/jobs/{id}"]?.get?.parameters).toStrictEqual([
      expect.objectContaining({
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      }),
    ]);
  });

  it("derives Job list and detail paths from the oRPC contract - 2", () => {
    expect(document.paths?.["/api/v1/jobs/{id}"]?.get?.responses?.["200"]).toMatchObject({
      description: "Successful response",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Job" },
        },
      },
    });
    expect(document.components?.schemas?.["Job"]).toMatchObject({
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        status: {
          enum: ["pending", "processing", "completed", "failed", "cancelled"],
          type: "string",
        },
        nextRunAt: { type: "string", format: "date-time" },
        lockedAt: {
          anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
        },
        claimedBy: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        lastHeartbeat: {
          anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
        },
        failCount: { type: "integer" },
        failureReason: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
      required: [
        "id",
        "name",
        "status",
        "priority",
        "payload",
        "nextRunAt",
        "lockedAt",
        "claimedBy",
        "lastHeartbeat",
        "failCount",
        "failureReason",
        "createdAt",
        "updatedAt",
      ],
      additionalProperties: false,
    });
    expect(document.components?.schemas?.["JobCursorPage"]).toMatchObject({
      type: "object",
      required: ["jobs", "cursor", "hasNextPage", "hasPreviousPage"],
      additionalProperties: false,
    });
  });

  it("derives bulk action paths, schemas, and error statuses from the oRPC contract - 1", () => {
    const paths = [
      ["/api/v1/jobs/actions/cancel", "cancelJobs"],
      ["/api/v1/jobs/actions/retry", "retryJobs"],
      ["/api/v1/jobs/actions/delete", "deleteJobs"],
    ] as const;
    for (const [path, operationId] of paths) {
      const operation = document.paths?.[path]?.post;

      expect(operation?.operationId).toBe(operationId);
      expect(operation?.requestBody).toMatchObject({
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/JobSelector" },
          },
        },
      });
      expect(operation?.responses?.["200"]).toMatchObject({
        description: "Successful response",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/BulkActionResult" },
          },
        },
      });
      for (const status of ["400", "403", "409", "500"]) {
        expect(operation?.responses?.[status]).toMatchObject({
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ManagementError" },
            },
          },
        });
      }
    }
    expect(document.components?.schemas?.["JobSelector"]).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string" },
        status: {
          anyOf: [
            {
              enum: ["pending", "processing", "completed", "failed", "cancelled"],
              type: "string",
            },
            {
              type: "array",
              minItems: 1,
              items: {
                enum: ["pending", "processing", "completed", "failed", "cancelled"],
                type: "string",
              },
            },
          ],
        },
        olderThan: { type: "string", format: "date-time" },
        newerThan: { type: "string", format: "date-time" },
      },
      additionalProperties: false,
    });
  });

  it("derives bulk action paths, schemas, and error statuses from the oRPC contract - 2", () => {
    expect(document.components?.schemas?.["BulkActionResult"]).toMatchObject({
      type: "object",
      properties: {
        count: { type: "integer" },
      },
      required: ["count", "errors"],
      additionalProperties: false,
    });
    expect(document.components?.schemas?.["ManagementError"]).toMatchObject({
      type: "object",
      required: ["error"],
      additionalProperties: false,
    });
  });

  it("derives single Job action paths, schemas, and error statuses from the oRPC contract - 1", () => {
    const jobResponseRoutes = [
      ["/api/v1/jobs/{id}/actions/cancel", "cancelJob"],
      ["/api/v1/jobs/{id}/actions/retry", "retryJob"],
      ["/api/v1/jobs/{id}/actions/reschedule", "rescheduleJob"],
    ] as const;
    for (const [path, operationId] of jobResponseRoutes) {
      const operation = document.paths?.[path]?.post;

      expect(operation?.operationId).toBe(operationId);
      expect(operation?.parameters).toStrictEqual([
        expect.objectContaining({
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
        }),
      ]);
      expect(operation?.responses?.["200"]).toMatchObject({
        description: "Successful response",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Job" },
          },
        },
      });
      for (const status of ["400", "403", "404", "409", "500"]) {
        expect(operation?.responses?.[status]).toMatchObject({
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ManagementError" },
            },
          },
        });
      }
    }
    expect(document.paths?.["/api/v1/jobs/{id}"]?.delete?.parameters).toStrictEqual([
      expect.objectContaining({
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      }),
    ]);
  });

  it("derives single Job action paths, schemas, and error statuses from the oRPC contract - 2", () => {
    const deleteResponses = document.paths?.["/api/v1/jobs/{id}"]?.delete?.responses;
    expect(
      document.paths?.["/api/v1/jobs/{id}/actions/reschedule"]?.post?.requestBody,
    ).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/RescheduleJobRequest" },
        },
      },
    });
    expect(document.paths?.["/api/v1/jobs/{id}"]?.delete?.operationId).toBe("deleteJob");
    expect(deleteResponses?.["200"]).toMatchObject({
      description: "Successful response",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/DeleteJob" },
        },
      },
    });
    for (const status of ["400", "403", "404", "409", "500"]) {
      expect(deleteResponses?.[status]).toMatchObject({
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ManagementError" },
          },
        },
      });
    }
    expect(document.components?.schemas?.["RescheduleJobRequest"]).toMatchObject({
      type: "object",
      required: ["nextRunAt"],
      additionalProperties: false,
    });
  });

  it("derives single Job action paths, schemas, and error statuses from the oRPC contract - 3", () => {
    expect(document.components?.schemas?.["DeleteJob"]).toMatchObject({
      type: "object",
      required: ["deleted"],
      additionalProperties: false,
    });
  });
});
