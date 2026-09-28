import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

const dashboardPackageDirectory = dirname(fileURLToPath(import.meta.url));

let dashboardClientBuild: Promise<void> | undefined;

function buildDashboardClient(): Promise<void> {
  dashboardClientBuild ??= new Promise((resolve, reject) => {
    const child = spawn("vp", ["build"], {
      cwd: dashboardPackageDirectory,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Dashboard client build failed with code ${code} and signal ${signal}.`));
    });
  });
  return dashboardClientBuild;
}

const config = defineConfig({
  run: {
    tasks: {
      dev: {
        command: "vp dev --port 3000",
        cache: false,
        dependsOn: [
          {
            task: "build",
            from: ["dependencies", "devDependencies"],
          },
        ],
      },
      build: {
        command: "vp pack",
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
      "build:client": {
        command: "vp build",
      },
      "check:exports": {
        command: "publint && attw --pack .",
        dependsOn: ["build"],
        cache: {
          output: [],
        },
      },
      clean: {
        command: "rimraf dist",
        cache: false,
      },
      preview: {
        command: "vp preview",
        cache: false,
      },
      "type-check": {
        command: "vp lint --type-aware --type-check -A all",
        dependsOn: [
          {
            task: "build",
            from: ["dependencies", "devDependencies"],
          },
        ],
        // The native type checker cannot run under Linux task file tracing.
        cache: false,
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
      lint: {
        command: "vp lint .",
        cache: false,
      },
    },
  },
  test: {
    name: "@monque/dashboard",
    maxWorkers: 2,
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup/browser.ts"],
  },
  pack: {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: false,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    deps: {
      neverBundle: ["@monque/management"],
    },
    hooks: {
      "build:done": async () => {
        await buildDashboardClient();
      },
    },
    publint: true,
    attw: {
      // Validate both ESM and CommonJS consumers.
      profile: "strict",
    },
  },

  base: "./",
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@monque/management/contract": fileURLToPath(
        new URL("../management/src/contract.ts", import.meta.url),
      ),
    },
  },
  build: {
    manifest: true,
    outDir: "dist/client",
    emptyOutDir: true,
  },
  plugins:
    lazyPlugins(() => [
      devtools({
        consolePiping: {
          enabled: true,
          levels: ["log", "warn", "error"],
        },
        enhancedLogs: {
          enabled: true,
        },
        eventBusConfig: {
          debug: false,
          enabled: true,
          port: 4206,
        },
        injectSource: {
          enabled: true,
          ignore: {
            files: [/.*\.test\.(ts|tsx)$/],
          },
        },
        logging: true,
        removeDevtoolsOnBuild: true,
      }),
      tailwindcss(),
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      viteReact({ compiler: { target: "19" } }),
    ]) ?? [],
});

export default config;
