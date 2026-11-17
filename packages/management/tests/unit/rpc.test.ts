import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { describe, expect, it, vi } from "vite-plus/test";

import type { ManagementContract } from "@/contract";
import { createManagementSurface } from "@/index";
import type { ManagementOptions, ManagementMonque } from "@/surface";

import {
  createManagementJob,
  createManagementMonque,
  getManagementJobById,
} from "./management-test-utils";

const connect = (
  options: ManagementOptions<{ role: string }>,
  headers: ConstructorParameters<typeof Headers>[0] = {},
) => {
  const surface = createManagementSurface(options);

  const client = createORPCClient<RouterContractClient<ManagementContract>>(
    new RPCLink({
      origin: "https://management.test",
      url: "/custom/rpc",
      fetch: async (url, init) => {
        const request = new Request(url, init);

        for (const [name, value] of new Headers(headers)) {
          request.headers.set(name, value);
        }

        const result = await surface.rpcHandler.handle(request, {
          prefix: "/custom/rpc",
          context: { managementContext: { role: "operator" } },
        });

        if (!result.matched) {
          throw new Error("Unmatched RPC request");
        }

        return result.response;
      },
    }),
  );

  return { surface, client };
};

describe("Management RPC transport", () => {
  it("serves the same health result through RPC and public HTTP", async () => {
    const { surface, client } = connect({ monque: createManagementMonque() });
    await expect(client.health()).resolves.toStrictEqual({
      status: "ok",
      scheduler: { healthy: true },
    });

    const result = await surface.openApiHandler.handle(
      new Request("https://management.test/api/v1/health"),
    );

    expect(result.matched).toBe(true);

    if (!result.matched) {
      throw new Error("Unmatched HTTP request");
    }

    await expect(result.response.json()).resolves.toStrictEqual({
      status: "ok",
      scheduler: { healthy: true },
    });
  });

  it.each(["deny", "throw", "reject"])(
    "preserves native RPC errors for %s authorization",
    async (mode) => {
      const { client } = connect({
        monque: createManagementMonque(),
        authorize: ({ context }): boolean | Promise<boolean> => {
          expect(context.role).toBe("operator");

          if (mode === "throw") {
            throw new Error("private diagnostic");
          }

          if (mode === "reject") {
            return Promise.reject(new Error("private diagnostic"));
          }

          return false;
        },
      });

      await expect(client.jobs({})).rejects.toMatchObject({
        code: mode === "deny" ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
      });
    },
  );

  it("uses action inputs for authorization and redacts DTO payloads without changing dates", async () => {
    const job = createManagementJob();

    const authorize = vi.fn<NonNullable<ManagementOptions<{ role: string }>["authorize"]>>(
      ({ action, context, job: target }) => {
        expect(context.role).toBe("operator");

        return action === "read" || (action === "cancel" && target?._id.equals(job._id) === true);
      },
    );

    const { client } = connect({
      authorize,
      monque: createManagementMonque({
        getJob: getManagementJobById(job),
        cancelJob: async () => await Promise.resolve(job),
      }),
      serializePayload: async ({ context }) => await Promise.resolve({ role: context.role }),
    });

    const dto = await client.cancelJob({ params: { id: job._id.toHexString() } });
    expect(dto.payload).toStrictEqual({ role: "operator" });
    expect(dto.nextRunAt).toBe("2026-01-01T00:00:00.000Z");
    const capabilities = await client.capabilities();
    expect(capabilities.actions.retry).toBe(false);
    await expect(client.retryJob({ params: { id: job._id.toHexString() } })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("denies mutations and reports them unavailable in read-only mode", async () => {
    const cancelJobs = vi
      .fn<() => Promise<{ count: number; errors: [] }>>()
      .mockResolvedValue({ count: 1, errors: [] });

    const { client } = connect({ monque: createManagementMonque({ cancelJobs }), readOnly: true });
    const capabilities = await client.capabilities();
    expect(capabilities.actions.cancelBulk).toBe(false);
    await expect(client.cancelJobs({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(cancelJobs).not.toHaveBeenCalled();
  });

  it.each([
    [{ origin: "https://evil.test" }, {}, "FORBIDDEN"],
    [{ "sec-fetch-site": "cross-site" }, {}, "FORBIDDEN"],
    [{}, { maxBodySize: 2 }, "PAYLOAD_TOO_LARGE"],
  ] as const)("protects RPC before scheduler access (%j)", async (headers, options, code) => {
    const getJobsWithCursor = vi.fn<ManagementMonque["getJobsWithCursor"]>();
    const monque = createManagementMonque({ getJobsWithCursor });
    const { client } = connect({ monque, ...options }, headers);
    await expect(client.jobs({})).rejects.toMatchObject({ code });
    expect(getJobsWithCursor).not.toHaveBeenCalled();
  });

  it("allows configured trusted origins and validates RPC inputs", async () => {
    const { client } = connect(
      { monque: createManagementMonque(), trustedOrigins: ["https://host.test"] },
      { origin: "https://host.test" },
    );

    await expect(client.jobs({})).resolves.toMatchObject({ jobs: [] });
    await expect(client.jobs({ limit: "0" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("does not mount mutations on GET or match sibling prefixes", async () => {
    const { surface } = connect({ monque: createManagementMonque() });

    await Promise.all(
      ["/custom/rpc/cancelJobs", "/custom/rpc-other/health"].map(async (path) => {
        const result = await surface.rpcHandler.handle(
          new Request(`https://management.test${path}`),
          { prefix: "/custom/rpc" },
        );

        expect(result.matched).toBe(false);
      }),
    );
  });
});
