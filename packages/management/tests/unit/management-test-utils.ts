import type { PersistedJob } from "@monque/core";
import { ObjectId } from "mongodb";
import { vi, expect } from "vite-plus/test";

import type { ManagementMonque, ManagementOpenApiContext, ManagementSurface } from "@/surface";
import { parseObjectId } from "@/surface/request-mapping";

interface CreateManagementMonqueOptions {
  mutations?: boolean;
}

export const createManagementMonque = function createManagementMonque(
  overrides: Partial<ManagementMonque> = {},
  options: CreateManagementMonqueOptions = {},
): ManagementMonque {
  const mutationStubs: Partial<ManagementMonque> =
    options.mutations === true
      ? {
          cancelJob: vi.fn<NonNullable<ManagementMonque["cancelJob"]>>().mockResolvedValue(null),
          retryJob: vi.fn<NonNullable<ManagementMonque["retryJob"]>>().mockResolvedValue(null),
          rescheduleJob: vi
            .fn<NonNullable<ManagementMonque["rescheduleJob"]>>()
            .mockResolvedValue(null),
          deleteJob: vi.fn<NonNullable<ManagementMonque["deleteJob"]>>().mockResolvedValue(false),
          cancelJobs: vi
            .fn<NonNullable<ManagementMonque["cancelJobs"]>>()
            .mockResolvedValue({ count: 0, errors: [] }),
          retryJobs: vi
            .fn<NonNullable<ManagementMonque["retryJobs"]>>()
            .mockResolvedValue({ count: 0, errors: [] }),
          deleteJobs: vi
            .fn<NonNullable<ManagementMonque["deleteJobs"]>>()
            .mockResolvedValue({ count: 0, errors: [] }),
        }
      : {};

  return {
    isHealthy: () => true,
    getQueueViewSummaries: vi
      .fn<NonNullable<ManagementMonque["getQueueViewSummaries"]>>()
      .mockResolvedValue([]),
    getJobsWithCursor: vi.fn<ManagementMonque["getJobsWithCursor"]>().mockResolvedValue({
      jobs: [],
      cursor: null,
      hasNextPage: false,
      hasPreviousPage: false,
    }),
    getJob: vi.fn<ManagementMonque["getJob"]>().mockResolvedValue(null),
    getQueueStats: vi.fn<ManagementMonque["getQueueStats"]>().mockResolvedValue({
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      total: 0,
    }),
    ...mutationStubs,
    ...overrides,
  };
};

export const createManagementJob = function createManagementJob(
  overrides: Partial<PersistedJob> = {},
): PersistedJob {
  return {
    _id: new ObjectId(),
    name: "send-email",
    data: { to: "person@example.test" },
    status: "pending",
    nextRunAt: new Date("2026-01-01T00:00:00.000Z"),
    failCount: 0,
    createdAt: new Date("2025-12-31T23:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:01:00.000Z"),
    ...overrides,
  };
};

export const getManagementJobById = function getManagementJobById(
  job: PersistedJob,
): ManagementMonque["getJob"] {
  return async (id) => {
    const parsed = parseObjectId(id);

    if ("error" in parsed) {
      return await Promise.resolve(null);
    }

    return await Promise.resolve(parsed.value.equals(job._id) ? job : null);
  };
};

export const expectJsonResponse = async function expectJsonResponse(
  response: Response,
  status: number,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Assertion helpers accept arbitrary expected values, including asymmetric Vitest matchers.
  expectedBody: unknown,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.json()).toStrictEqual(expectedBody);
};

const handleManagementRequest = async function handleManagementRequest(
  surface: ManagementSurface,
  path: string,
  options: {
    method: string;
    body?: unknown;
    context?: ManagementOpenApiContext | undefined;
  },
): Promise<Response> {
  const init: RequestInit = { method: options.method };

  if (options.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }

  const result = await surface.openApiHandler.handle(
    new Request(`https://management.example${path}`, init),
    {
      context: options.context ?? { managementContext: {} },
    },
  );

  if (!result.matched) {
    throw new Error(`Expected oRPC OpenAPI handler to match ${path}`);
  }

  return result.response;
};

export const handleManagementGet = async function handleManagementGet(
  surface: ManagementSurface,
  path: string,
  context?: ManagementOpenApiContext,
): Promise<Response> {
  return await handleManagementRequest(surface, path, { method: "GET", context });
};

export const handleManagementPost = async function handleManagementPost(
  surface: ManagementSurface,
  path: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- HTTP fixtures deliberately include malformed request values to exercise validation.
  body?: unknown,
  context?: ManagementOpenApiContext,
): Promise<Response> {
  return await handleManagementRequest(surface, path, { method: "POST", body, context });
};

export const handleManagementDelete = async function handleManagementDelete(
  surface: ManagementSurface,
  path: string,
  context?: ManagementOpenApiContext,
): Promise<Response> {
  return await handleManagementRequest(surface, path, { method: "DELETE", context });
};
