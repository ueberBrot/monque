import { managementContract } from "@monque/management/contract";
import type { ManagementContract } from "@monque/management/contract";
import { createORPCClient, ORPCError, COMMON_ERROR_STATUS_MAP } from "@orpc/client";
import type { RouterContractClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { z } from "zod";

import type { DashboardRuntimeConfig } from "./runtime-config.js";

type DashboardManagementClient = JsonifiedClient<RouterContractClient<ManagementContract>>;

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

  const link = new OpenAPILink(managementContract, {
    origin: new URL(url).origin,
    url: `/${new URL(url).pathname.replace(/^\//u, "")}${new URL(url).search}${new URL(url).hash}`,
    fetch: async (request, init) =>
      await Promise.resolve(
        fetchImplementation(new Request(request, init), { credentials: "include" }),
      ),
    customErrorResponseBodyDecoder: (body, response) => {
      const parsed = z.object({ error: z.string() }).safeParse(body);

      return parsed.success
        ? Object.assign(
            new ORPCError(
              Object.entries(COMMON_ERROR_STATUS_MAP).find(
                ([, status]) => status === response.status,
              )?.[0] ?? "INTERNAL_SERVER_ERROR",
              {
                message: parsed.data.error,
                data: body,
              },
            ),
            { status: response.status },
          )
        : undefined;
    },
  });

  const client = createORPCClient<DashboardManagementClient>(link);
  const orpc = createTanstackQueryUtils(client);

  return { client, orpc };
};

export { createDashboardManagementApi, type DashboardManagementApi };
