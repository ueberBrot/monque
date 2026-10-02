import { type ManagementContract, managementContract } from "@monque/management/contract";
import { createORPCClient, ORPCError } from "@orpc/client";
import { getMalformedResponseErrorCode } from "@orpc/client/standard";
import type { ContractRouterClient } from "@orpc/contract";
import type { JsonifiedClient } from "@orpc/openapi-client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { DashboardRuntimeConfig } from "./runtime-config.js";

type DashboardManagementClient = JsonifiedClient<ContractRouterClient<ManagementContract>>;
type DashboardManagementORPC = ReturnType<
  typeof createTanstackQueryUtils<DashboardManagementClient>
>;

type DashboardManagementApi = {
  readonly client: DashboardManagementClient;
  readonly orpc: DashboardManagementORPC;
};

type CreateDashboardManagementClientOptions = Pick<DashboardRuntimeConfig, "apiBaseUrl"> & {
  readonly fetch?: typeof fetch;
  readonly origin?: string;
};

function createDashboardManagementApi(
  options: CreateDashboardManagementClientOptions,
): DashboardManagementApi {
  const { apiBaseUrl, origin } = options;
  const url = new URL(
    apiBaseUrl,
    origin === undefined ? window.location.origin : origin,
  ).toString();
  const fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  const link = new OpenAPILink(managementContract, {
    url,
    fetch: (request, init) => fetchImplementation(request, { ...init, credentials: "include" }),
    customErrorResponseBodyDecoder: (body, response) => {
      if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
      if (typeof body.error !== "string") return undefined;
      return new ORPCError(getMalformedResponseErrorCode(response.status), {
        status: response.status,
        message: body.error,
        data: body,
      });
    },
  });

  const client = createORPCClient<DashboardManagementClient>(link);
  const orpc = createTanstackQueryUtils(client);

  return { client, orpc };
}

export { createDashboardManagementApi, type DashboardManagementApi };
