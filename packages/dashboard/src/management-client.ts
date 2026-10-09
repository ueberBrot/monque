import { managementContract } from "@monque/management/contract";
import type { ManagementContract } from "@monque/management/contract";
import { createORPCClient, ORPCError } from "@orpc/client";
import { getMalformedResponseErrorCode } from "@orpc/client/standard";
import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { z } from "zod";

import type { DashboardRuntimeConfig } from "./runtime-config.js";

type DashboardManagementClient = JsonifiedClient<ContractRouterClient<ManagementContract>>;
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
    url,
    fetch: async (request, init) =>
      await Promise.resolve(fetchImplementation(request, { ...init, credentials: "include" })),
    customErrorResponseBodyDecoder: (body, response) => {
      const parsed = z.object({ error: z.string() }).safeParse(body);
      return parsed.success
        ? new ORPCError(getMalformedResponseErrorCode(response.status), {
            status: response.status,
            message: parsed.data.error,
            data: body,
          })
        : undefined;
    },
  });
  const client = createORPCClient<DashboardManagementClient>(link);
  const orpc = createTanstackQueryUtils(client);
  return { client, orpc };
};
export { createDashboardManagementApi, type DashboardManagementApi };
