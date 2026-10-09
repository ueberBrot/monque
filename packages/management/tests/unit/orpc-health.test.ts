import { describe, it } from "vite-plus/test";

import { createManagementSurface } from "@/index";
import {
  createManagementMonque,
  expectJsonResponse,
  handleManagementGet,
} from "@tests/unit/management-test-utils";

describe("oRPC Management health route", () => {
  it("serves scheduler health through the OpenAPI handler", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({ isHealthy: () => false }),
    });

    const response = await handleManagementGet(surface, "/api/v1/health");

    await expectJsonResponse(response, 200, {
      status: "unavailable",
      scheduler: {
        healthy: false,
      },
    });
  });

  it("serves scheduler health without read authorization", async () => {
    const surface = createManagementSurface({
      monque: createManagementMonque({ isHealthy: () => true }),
      authorize: () => false,
    });

    const response = await handleManagementGet(surface, "/api/v1/health");

    await expectJsonResponse(response, 200, {
      status: "ok",
      scheduler: {
        healthy: true,
      },
    });
  });
});
