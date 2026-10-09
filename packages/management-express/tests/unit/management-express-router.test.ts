import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { Monque } from "@monque/core";
import type { JobSelector, PersistedJob } from "@monque/core";
import type { ManagementAuthorize, ManagementMonque } from "@monque/management";
import { fromPartial } from "@total-typescript/shoehorn";
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import request from "supertest";
import { describe, expect, vi, it } from "vite-plus/test";

import { createRequest } from "@/http";
import { createManagementExpressRouter } from "@/index";
import type { ManagementExpressRouterOptions } from "@/index";

const createManagementMonque = function createManagementMonque(
  overrides: Partial<ManagementMonque> = {},
): ManagementMonque {
  return {
    isHealthy: () => true,
    getQueueViewSummaries: vi
      .fn<NonNullable<ManagementMonque["getQueueViewSummaries"]>>()
      .mockResolvedValue([]),
    getJobsWithCursor: vi
      .fn<NonNullable<ManagementMonque["getJobsWithCursor"]>>()
      .mockResolvedValue({
        jobs: [],
        cursor: null,
        hasNextPage: false,
        hasPreviousPage: false,
      }),
    getJob: vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(null),
    getQueueStats: vi.fn<NonNullable<ManagementMonque["getQueueStats"]>>().mockResolvedValue({
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      total: 0,
    }),
    ...overrides,
  };
};

const createManagementApp = function createManagementApp<TContext>(
  options: ManagementExpressRouterOptions<TContext>,
): Express {
  const app = express();

  app.use("/monque", createManagementExpressRouter(options));

  return app;
};

const createRequestMock = function createRequestMock({
  body,
  headers = {},
  host = "example.test",
  method = "POST",
  protocol = "https",
  url = "/api/v1/jobs/actions/cancel",
}: {
  body?: unknown;
  headers?: Request["headers"];
  host?: string;
  method?: string;
  protocol?: string;
  url?: string;
}): Request {
  return fromPartial<Request>({
    body,
    get: (name: string) => (name.toLowerCase() === "host" ? host : undefined),
    headers,
    method,
    protocol,
    url,
  });
};

const mountErrorJson = function mountErrorJson(app: Express): void {
  // oxlint-disable-next-line promise/prefer-await-to-callbacks, anti-slop/no-unknown-parameters -- Express identifies error middleware by four arguments and may deliver arbitrary thrown values.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });
};

describe("Express Management Adapter", () => {
  it("rejects sibling-origin forms carrying an authenticated operator cookie", async () => {
    const deleteJobs = vi
      .fn<NonNullable<ManagementMonque["deleteJobs"]>>()
      .mockResolvedValue({ count: 3, errors: [] });
    const authorize = vi.fn<() => boolean>(() => true);
    const app = express();
    app.use("/monque", (req, res, next) => {
      if (req.get("cookie") !== "session=valid-operator") {
        res.sendStatus(401);
        return;
      }
      next();
    });
    app.use(
      "/monque",
      createManagementExpressRouter({ monque: createManagementMonque({ deleteJobs }), authorize }),
    );

    const response = await request(app)
      .post("/monque/api/v1/jobs/actions/delete")
      .set("Host", "ops.example.com")
      .set("Origin", "http://evil.example.com")
      .set("Sec-Fetch-Site", "same-site")
      .set("Cookie", "session=valid-operator")
      .type("form")
      .send("")
      .expect(403);

    expect(response.body).toStrictEqual({ error: "Untrusted request origin" });
    expect(deleteJobs).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it.each(["http://ops.example.com", "https://dashboard.example.com"])(
    "permits authenticated mutations from approved origin %s",
    async (origin) => {
      const deleteJobs = vi
        .fn<NonNullable<ManagementMonque["deleteJobs"]>>()
        .mockResolvedValue({ count: 3, errors: [] });
      const app = createManagementApp({
        monque: createManagementMonque({ deleteJobs }),
        trustedOrigins: ["https://dashboard.example.com"],
        context: ({ req }) => ({ authenticated: req.get("cookie") === "session=valid-operator" }),
        authorize: ({ context }) => context.authenticated,
      });
      const response = await request(app)
        .post("/monque/api/v1/jobs/actions/delete")
        .set("Host", "ops.example.com")
        .set("Origin", origin)
        .set("Cookie", "session=valid-operator")
        .send({})
        .expect(200);

      expect(response.body).toStrictEqual({ count: 3, errors: [] });
      expect(deleteJobs).toHaveBeenCalledWith({});
    },
  );

  it("preserves host route fallthrough for unrelated cross-origin POST requests", async () => {
    const app = createManagementApp({ monque: createManagementMonque() });
    app.post("/monque/host-feature", (_req, res) => res.status(202).json({ accepted: true }));

    const response = await request(app)
      .post("/monque/host-feature")
      .set("Origin", "https://other.example.com")
      .send({})
      .expect(202);

    expect(response.body).toStrictEqual({ accepted: true });
  });

  it("controls the addressed scheduler through the mounted HTTP routes", async () => {
    const monque = new Monque(new MongoClient("mongodb://localhost:27017").db("controls"));
    const app = createManagementApp({ monque });
    const state = await request(app).get("/monque/api/v1/processing").expect(200);
    expect(state.body).toHaveProperty("instanceId", monque.getProcessingState().instanceId);
    const body = { instanceId: monque.getProcessingState().instanceId, name: "email" };
    await request(app).post("/monque/api/v1/processing/actions/pause").send(body).expect(200);
    expect(monque.isPaused("email")).toBe(true);
    await request(app)
      .post("/monque/api/v1/processing/actions/resume")
      .send({ ...body, instanceId: "other" })
      .expect(409);
    expect(monque.isPaused("email")).toBe(true);
    await request(app).post("/monque/api/v1/processing/actions/resume").send(body).expect(200);
    expect(monque.isPaused("email")).toBe(false);
  });

  it("serves local worker policies through the mounted queue-view endpoint", async () => {
    const worker = {
      concurrency: 2,
      activeCount: 1,
      paused: true,
      hasSchema: true,
      maxRetries: 3,
      baseRetryInterval: 0,
      maxBackoffDelay: 100,
    };
    const app = createManagementApp({
      monque: createManagementMonque({
        getQueueViewSummaries: vi
          .fn<NonNullable<ManagementMonque["getQueueViewSummaries"]>>()
          .mockResolvedValue([
            {
              name: "work",
              hasPersistedJobs: false,
              hasRegisteredWorker: true,
              stats: { pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, total: 0 },
              worker,
            },
          ]),
      }),
    });
    const response = await request(app).get("/monque/api/v1/queue-views").expect(200);
    expect(response.body).toMatchObject({ queueViews: [{ name: "work", worker }] });
  });

  it("exposes an immediate failure and permits manual retry through the mounted API", async () => {
    const job: PersistedJob = {
      _id: new ObjectId(),
      name: "deliver",
      data: {},
      status: "failed",
      failCount: 1,
      failReason: "Account no longer exists",
      nextRunAt: new Date("2026-01-15T08:00:00Z"),
      createdAt: new Date("2026-01-15T00:00:00Z"),
      updatedAt: new Date("2026-01-15T08:00:00Z"),
    };
    const retryJob = vi
      .fn<NonNullable<ManagementMonque["retryJob"]>>()
      .mockResolvedValue({ ...job, status: "pending" as const, failCount: 0 });
    const app = createManagementApp({
      monque: createManagementMonque({
        getJob: vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(job),
        retryJob,
      }),
    });
    const path = `/monque/api/v1/jobs/${job._id.toHexString()}`;
    const failed = await request(app).get(path).expect(200);
    expect(failed.body).toMatchObject({
      status: "failed",
      failCount: 1,
      failureReason: "Account no longer exists",
    });
    const retried = await request(app).post(`${path}/actions/retry`).expect(200);
    expect(retried.body).toMatchObject({ status: "pending", failCount: 0 });
    expect(retryJob).toHaveBeenCalledWith(job._id.toHexString());
  });

  it("serves recurring schedule timezone metadata through the mounted API", async () => {
    const job: PersistedJob = {
      _id: new ObjectId(),
      name: "daily-report",
      data: {},
      status: "pending",
      failCount: 0,
      repeatInterval: "0 9 * * *",
      timezone: "Europe/Berlin",
      nextRunAt: new Date("2026-01-15T08:00:00Z"),
      createdAt: new Date("2026-01-15T00:00:00Z"),
      updatedAt: new Date("2026-01-15T00:00:00Z"),
    };
    const app = createManagementApp({
      monque: createManagementMonque({
        getJob: vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(job),
      }),
    });
    const response = await request(app)
      .get(`/monque/api/v1/jobs/${job._id.toHexString()}`)
      .expect(200);
    expect(response.body).toMatchObject({
      timezone: "Europe/Berlin",
      nextRunAt: "2026-01-15T08:00:00.000Z",
    });
  });

  it("preserves array headers while skipping undefined headers", () => {
    const fetchRequest = createRequest(
      createRequestMock({
        body: { name: "send-email" },
        headers: {
          "x-forwarded-host": ["ops.example.test", "fallback.example.test"],
          "x-missing-header": undefined,
        },
      }),
    );

    expect(fetchRequest.headers.get("x-forwarded-host")).toBe(
      "ops.example.test, fallback.example.test",
    );
    expect(fetchRequest.headers.has("x-missing-header")).toBe(false);
  });

  it("creates Fetch requests from already-parsed body types", async () => {
    const cases = [
      {
        body: "plain body",
        expected: "plain body",
      },
      {
        body: Buffer.from("buffer body"),
        expected: "buffer body",
      },
      {
        body: new URLSearchParams({ name: "send-email", status: "pending" }),
        expected: "name=send-email&status=pending",
      },
    ];

    await Promise.all(
      cases.map(async ({ body, expected }) => {
        const fetchRequest = createRequest(createRequestMock({ body }));
        await expect(fetchRequest.text()).resolves.toBe(expected);
      }),
    );
  });

  it("serves management routes under the host mount path", async () => {
    const app = createManagementApp({
      monque: createManagementMonque({ isHealthy: () => false }),
    });

    await request(app)
      .get("/monque/api/v1/health")
      .expect(200)
      .expect("content-type", /json/u)
      .expect({
        status: "unavailable",
        scheduler: {
          healthy: false,
        },
      });

    const notFound = await request(app).get("/api/v1/health");
    expect(notFound.status).toBe(404);
  });

  it("passes Express-derived context into management authorization hooks", async () => {
    const authorize = vi.fn<ManagementAuthorize<{ role: string }>>(
      ({ context }) => context.role === "operator",
    );
    const app = createManagementApp<{ role: string }>({
      monque: createManagementMonque(),
      context: ({ req }) => ({ role: req.get("x-role") ?? "viewer" }),
      authorize,
    });

    await request(app)
      .get("/monque/api/v1/capabilities")
      .set("x-role", "operator")
      .expect(200)
      .expect({
        readOnly: false,
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

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "read",
        context: { role: "operator" },
      }),
    );
  });

  it("reports missing context when authorization is configured without a context factory", async () => {
    const authorize = vi.fn<ManagementAuthorize>(({ action }) => action === "read");
    const app = createManagementApp({
      monque: createManagementMonque(),
      authorize,
    });

    await request(app).get("/monque/api/v1/capabilities").expect(500).expect({
      error:
        "Missing managementContext in openApiHandler.handle() context; managementContext is required for authorize/serializePayload hooks.",
    });

    expect(authorize).not.toHaveBeenCalled();
  });

  it("serves the management OpenAPI document with mount-specific server metadata", async () => {
    const app = createManagementApp({
      monque: createManagementMonque(),
    });

    const response = await request(app)
      .get("/monque/openapi.json")
      .expect(200)
      .expect("content-type", /json/u);

    expect(response.body).toMatchObject({
      openapi: "3.1.1",
      info: { title: "Monque Management API" },
      servers: [{ url: "/monque" }],
    });
    expect(response.body).toHaveProperty(["paths", "/api/v1/health"]);
  });

  it("serves OpenAPI JSON from a configured path and server URL", async () => {
    const app = createManagementApp({
      monque: createManagementMonque(),
      openApi: {
        path: "docs/openapi.json",
        serverUrl: "https://ops.example.test/monque",
      },
    });

    const response = await request(app).get("/monque/docs/openapi.json").expect(200);

    expect(response.body).toHaveProperty("servers", [{ url: "https://ops.example.test/monque" }]);
    await request(app).get("/monque/openapi.json").expect(404);
  });

  it("resolves OpenAPI server metadata from Express request state", async () => {
    const app = createManagementApp({
      monque: createManagementMonque(),
      openApi: {
        serverUrl: async ({ req, res }) => {
          res.setHeader("x-openapi-server-source", "resolver");

          return await Promise.resolve(
            `https://${req.get("x-forwarded-host") ?? req.get("host")}${req.baseUrl}`,
          );
        },
      },
    });

    const response = await request(app)
      .get("/monque/openapi.json")
      .set("x-forwarded-host", "ops.example.test")
      .expect(200)
      .expect("x-openapi-server-source", "resolver");

    expect(response.body).toHaveProperty("servers", [{ url: "https://ops.example.test/monque" }]);
  });

  it("forwards OpenAPI document errors to Express error middleware", async () => {
    const app = createManagementApp({
      monque: createManagementMonque(),
      openApi: {
        serverUrl: () => {
          throw new Error("OpenAPI server URL failed");
        },
      },
    });
    mountErrorJson(app);

    const httpResponse1 = await request(app).get("/monque/openapi.json");
    expect(httpResponse1).toMatchObject({
      status: 500,
      body: {
        error: "OpenAPI server URL failed",
      },
    });
  });

  it("can disable adapter-served OpenAPI JSON", async () => {
    const app = createManagementApp({
      monque: createManagementMonque(),
      openApi: false,
    });

    const httpResponse2 = await request(app).get("/monque/openapi.json");
    expect(httpResponse2).toMatchObject({ status: 404 });

    const httpResponse3 = await request(app).get("/monque/api/v1/health");
    expect(httpResponse3).toMatchObject({ status: 200 });
  });

  it("lets host auth middleware wrap body-bearing management routes", async () => {
    const app = express();
    const selectors: JobSelector[] = [];

    app.use((req, res, next) => {
      if (req.get("authorization") !== "Bearer secret") {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      next();
    });
    app.use(
      "/monque",
      createManagementExpressRouter({
        monque: createManagementMonque({
          cancelJobs: async (selector) => {
            selectors.push(selector);

            return await Promise.resolve({
              count: 2,
              errors: [],
            });
          },
        }),
      }),
    );

    await request(app).post("/monque/api/v1/jobs/actions/cancel").expect(401).expect({
      error: "Unauthorized",
    });

    await request(app)
      .post("/monque/api/v1/jobs/actions/cancel")
      .set("authorization", "Bearer secret")
      .send({
        name: "send-email",
        status: ["pending"],
        olderThan: "2026-02-01T10:30:00.000Z",
      })
      .expect(200)
      .expect({
        count: 2,
        errors: [],
      });

    expect(selectors).toStrictEqual([
      {
        name: "send-email",
        status: ["pending"],
        olderThan: new Date("2026-02-01T10:30:00.000Z"),
      },
    ]);
  });

  it("accepts body-bearing management routes after Express parsed JSON", async () => {
    const app = express();
    const selectors: JobSelector[] = [];

    app.use(express.json());
    app.use(
      "/monque",
      createManagementExpressRouter({
        monque: createManagementMonque({
          cancelJobs: async (selector) => {
            selectors.push(selector);

            return await Promise.resolve({
              count: 1,
              errors: [],
            });
          },
        }),
      }),
    );

    await request(app)
      .post("/monque/api/v1/jobs/actions/cancel")
      .send({
        name: "send-email",
        status: ["pending"],
      })
      .expect(200)
      .expect({
        count: 1,
        errors: [],
      });

    expect(selectors).toStrictEqual([
      {
        name: "send-email",
        status: ["pending"],
      },
    ]);
  });

  it.each([false, true])(
    "rejects oversized requests before job access with parsed middleware %s",
    async (parsed) => {
      const getJob = vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(null);
      const cancelJob = vi.fn<NonNullable<ManagementMonque["cancelJob"]>>().mockResolvedValue(null);
      const authorize = vi.fn<() => boolean>(() => false);
      const app = express();
      if (parsed) {
        app.use(express.json({ limit: "1mb" }));
      }
      app.use(
        "/monque",
        createManagementExpressRouter({
          monque: createManagementMonque({ getJob, cancelJob }),
          authorize,
        }),
      );

      await request(app)
        .post("/monque/api/v1/jobs/507f1f77bcf86cd799439011/actions/cancel")
        .set("content-type", "application/json")
        .send(JSON.stringify({ ignored: "x".repeat(70_000) }))
        .expect(413)
        .expect({ error: "Payload Too Large" });

      expect(getJob).not.toHaveBeenCalled();
      expect(cancelJob).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
    },
  );

  it("applies a configured limit to approved parsed JSON mutations", async () => {
    const deleteJobs = vi
      .fn<NonNullable<ManagementMonque["deleteJobs"]>>()
      .mockResolvedValue({ count: 1, errors: [] });
    const app = express();
    app.use(express.json());
    app.use(
      "/monque",
      createManagementExpressRouter({
        monque: createManagementMonque({ deleteJobs }),
        maxBodySize: 2,
        trustedOrigins: ["https://ops.example"],
      }),
    );

    await request(app)
      .post("/monque/api/v1/jobs/actions/delete")
      .set("origin", "https://ops.example")
      .send({})
      .expect(200);
    await request(app)
      .post("/monque/api/v1/jobs/actions/delete")
      .set("origin", "https://ops.example")
      .send({ name: "work" })
      .expect(413);

    expect(deleteJobs).toHaveBeenCalledExactlyOnceWith({});
  });

  it("returns 413 for an ongoing chunked upload without waiting for its end", async () => {
    const getJob = vi.fn<NonNullable<ManagementMonque["getJob"]>>().mockResolvedValue(null);
    const cancelJob = vi.fn<NonNullable<ManagementMonque["cancelJob"]>>().mockResolvedValue(null);
    const app = createManagementApp({ monque: createManagementMonque({ getJob, cancelJob }) });
    const server = createServer((req, res) => {
      app(req, res);
    });
    const listening = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await listening;
    const address = server.address();
    const isNetworkListener = (value: ReturnType<typeof server.address>): value is AddressInfo =>
      value !== null && "port" in new Object(value);
    if (!isNetworkListener(address)) {
      throw new Error("Expected a local HTTP listener");
    }
    let client: ReturnType<typeof httpRequest> | undefined;
    try {
      const received: PromiseWithResolvers<IncomingMessage> = Promise.withResolvers();
      client = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          method: "POST",
          path: "/monque/api/v1/jobs/507f1f77bcf86cd799439011/actions/cancel",
          headers: { "content-type": "application/json" },
        },
        received.resolve,
      );
      client.on("error", received.reject);
      client.write(Buffer.alloc(65_537, 32));
      const incoming = await received.promise;
      incoming.setEncoding("utf-8");
      const chunks: string[] = [];
      for await (const chunk of incoming) {
        chunks.push(String(chunk));
      }
      const response = { status: incoming.statusCode, body: chunks.join("") };

      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toStrictEqual({ error: "Payload Too Large" });
      expect(getJob).not.toHaveBeenCalled();
      expect(cancelJob).not.toHaveBeenCalled();
    } finally {
      client?.destroy();
      server.closeAllConnections();
      await server[Symbol.asyncDispose]();
    }
  });

  it("forwards management route errors to Express error middleware", async () => {
    const app = createManagementApp({
      monque: createManagementMonque(),
      context: () => {
        throw new Error("Management context failed");
      },
    });
    mountErrorJson(app);

    const httpResponse4 = await request(app).get("/monque/api/v1/health");
    expect(httpResponse4).toMatchObject({
      status: 500,
      body: {
        error: "Management context failed",
      },
    });
  });
});
