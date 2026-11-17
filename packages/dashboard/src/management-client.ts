import type { ManagementContract } from "@monque/management/contract";
import { createORPCClient, ORPCError, COMMON_ERROR_STATUS_MAP } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContractClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { z } from "zod";

import type { DashboardRuntimeConfig } from "./runtime-config.js";

type DashboardManagementClient = RouterContractClient<ManagementContract>;

type DashboardManagementORPC = ReturnType<
  typeof createTanstackQueryUtils<DashboardManagementClient>
>;

interface DashboardManagementApi {
  readonly client: DashboardManagementClient;
  readonly orpc: DashboardManagementORPC;
}

type CreateDashboardManagementClientOptions = Pick<DashboardRuntimeConfig, "apiBaseUrl"> & {
  readonly fetch?: typeof fetch;
  readonly origin?: string;
};

const createDashboardManagementApi = (
  options: CreateDashboardManagementClientOptions,
): DashboardManagementApi => {
  const { apiBaseUrl, origin } = options;
  const url = new URL(apiBaseUrl, origin ?? window.location.origin).toString();
  const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);

  const base = new URL(url);
  base.pathname = `${base.pathname.replace(/\/$/u, "")}/rpc`;

  const link = new RPCLink({
    origin: base.origin,
    url: `/${base.pathname.replace(/^\//u, "")}${base.search}${base.hash}`,
    fetch: async (request, init) => {
      const response = await fetchImplementation(new Request(request, init), {
        credentials: "include",
      });

      // Host authentication middleware may reject before the RPC handler is reached.
      if (
        !response.ok &&
        response.headers.get("content-type")?.includes("application/json") === true
      ) {
        const code =
          Object.entries(COMMON_ERROR_STATUS_MAP).find(
            ([, status]) => status === response.status,
          )?.[0] ?? "INTERNAL_SERVER_ERROR";

        const parsed = z.object({ error: z.string() }).safeParse(
          await response
            .clone()
            .json()
            .catch(() => {
              throw Object.assign(new ORPCError(code), { status: response.status });
            }),
        );

        if (parsed.success) {
          throw Object.assign(new ORPCError(code, { message: parsed.data.error }), {
            status: response.status,
          });
        }
      }

      return response;
    },
  });

  const client = createORPCClient<DashboardManagementClient>(link);
  const orpc = createTanstackQueryUtils(client);

  return { client, orpc };
};

export { createDashboardManagementApi, type DashboardManagementApi };
