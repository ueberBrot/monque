import type { ManagementContract } from "@monque/management/contract";
import { createORPCClient, ResponseError } from "@orpc/client";
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
    fetch: async (requestUrl, init) => {
      const response = await fetchImplementation(requestUrl, {
        ...init,
        credentials: "include",
      });

      // Host authentication middleware may reject before the RPC handler is reached.
      if (
        !response.ok &&
        response.headers.get("content-type")?.includes("application/json") === true
      ) {
        const body: unknown = await response
          .clone()
          .json()
          .catch(() => null);

        const resolved = {
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body,
        };

        const parsed = z.object({ error: z.string() }).safeParse(resolved.body);

        if (parsed.success || body === null) {
          throw new ResponseError({
            message: parsed.success ? parsed.data.error : undefined,
            response: resolved,
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
