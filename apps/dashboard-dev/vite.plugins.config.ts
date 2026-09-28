import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ViteDevServer } from "vite-plus";

import { readDashboardDevServerEnvironment } from "./src/environment.js";
import { isDashboardDevScenarioId } from "./src/mock/scenario-catalog.js";

export default defineConfig(async ({ mode }) => {
  const { environment, mongoUri, databaseName } = readDashboardDevServerEnvironment(
    loadEnv(mode, process.cwd(), ""),
  );
  const devMode = environment.mode;

  const { createLocalDbManagementServer } = await import("./src/local-db/management-server.js");
  const { createManagementMiddleware, MANAGEMENT_MOUNT_PATH } =
    await import("./src/management-middleware.js");
  const { createMockManagementOpenApiHandler } = await import("./src/mock/management-server.js");
  const mockHandler = createMockManagementOpenApiHandler();
  let localDbServer: ReturnType<typeof createLocalDbManagementServer> | undefined;
  return {
    plugins: [
      tailwindcss(),
      viteReact({ compiler: { target: "19" } }),
      {
        name: "monque-dashboard-dev-mock-api",
        configureServer(server: ViteDevServer) {
          if (devMode !== "mock") {
            return;
          }

          server.middlewares.use(
            MANAGEMENT_MOUNT_PATH,
            createManagementMiddleware(async (request) => {
              const scenarioHeader = request.headers.get("x-monque-dev-scenario");
              const scenarioId = isDashboardDevScenarioId(scenarioHeader)
                ? scenarioHeader
                : environment.scenarioId;
              const result = await mockHandler.handle(request, { context: { scenarioId } });
              return result.matched ? result.response : undefined;
            }),
          );
        },
      },
      {
        name: "monque-dashboard-dev-local-db-api",
        configureServer(server: ViteDevServer) {
          if (devMode !== "db") {
            return;
          }

          localDbServer = createLocalDbManagementServer({
            mongoUri,
            databaseName,
          });

          server.middlewares.use(MANAGEMENT_MOUNT_PATH, localDbServer.middleware);
          void localDbServer.start().catch((error: unknown) => {
            server.config.logger.error(error instanceof Error ? error.message : String(error));
          });
        },
        async closeBundle() {
          await localDbServer?.close();
        },
      },
    ],
  };
});
