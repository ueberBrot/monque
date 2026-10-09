import { fileURLToPath } from "node:url";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins, loadConfigFromFile, loadEnv } from "vite-plus";

import { readDashboardDevServerEnvironment } from "./src/environment.js";

const config = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "MONQUE_DASHBOARD_");
  const { environment, liveApiBaseUrl } = readDashboardDevServerEnvironment(env);
  const devMode = environment.mode;

  return {
    run: {
      tasks: {
        dev: {
          command: "vp dev",
          cache: false,
          dependsOn: [
            {
              task: "build",
              from: ["dependencies", "devDependencies"],
            },
          ],
        },
        "dev:db": {
          command: "MONQUE_DASHBOARD_DEV_MODE=db vp dev",
          cache: false,
          dependsOn: [
            {
              task: "build",
              from: ["dependencies", "devDependencies"],
            },
          ],
        },
        build: {
          command: "vp build",
          dependsOn: [
            {
              task: "build",
              from: ["dependencies", "devDependencies"],
            },
          ],
          cache: {
            env: ["NODE_ENV", "MONQUE_DASHBOARD_*"],
            output: ["dist/**"],
          },
        },
        preview: {
          command: "vp preview",
          cache: false,
        },
        "type-check": {
          command: "vp lint --type-aware --type-check --deny-warnings",
          dependsOn: [
            {
              task: "build",
              from: ["dependencies", "devDependencies"],
            },
          ],
          cache: { output: [] },
        },
        test: {
          command: "vp test run",
          dependsOn: ["type-check"],
          cache: false,
        },
        "test:unit": {
          command: "vp test run",
          dependsOn: ["type-check"],
          cache: {
            env: ["CI", "TZ"],
            output: [],
          },
        },
        "test:e2e": {
          command: "playwright test",
          dependsOn: ["@monque/dashboard-express#build", "@monque/management-express#build"],
          cache: false,
        },
        clean: {
          command: "rimraf dist",
          cache: false,
        },
      },
    },
    test: {
      environment: "node",
      maxWorkers: 2,
      include: ["tests/unit/**/*.test.{ts,tsx}"],
      setupFiles: ["../../packages/dashboard/tests/setup/browser.ts"],
    },

    define: {
      "import.meta.env.MONQUE_DASHBOARD_DEV_CONFIG": JSON.stringify(environment),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("../../packages/dashboard/src", import.meta.url)),
        "@dashboard-dev": fileURLToPath(new URL("src", import.meta.url)),
        "@monque/management/contract": fileURLToPath(
          new URL("../../packages/management/src/contract.ts", import.meta.url),
        ),
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server:
      devMode === "live" && liveApiBaseUrl !== undefined && liveApiBaseUrl.length > 0
        ? {
            port: 3400,
            proxy: {
              "/api": {
                changeOrigin: true,
                target: liveApiBaseUrl,
              },
            },
          }
        : { port: 3400 },
    plugins:
      lazyPlugins(async () => {
        if (process.env["VITEST"] !== undefined && process.env["VITEST"].length > 0) {
          return [viteReact()];
        }
        // Defer workspace runtime imports until builds have produced their entrypoints.
        const loaded = await loadConfigFromFile(
          { command: "serve", mode },
          fileURLToPath(new URL("vite.plugins.config.ts", import.meta.url)),
        );
        if (!loaded) {
          throw new Error("Could not load dashboard development plugins");
        }
        return loaded.config.plugins ?? [];
      }) ?? [],
  };
});

export default config;
