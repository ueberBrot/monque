import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
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
        command: "vp test run --config vite.unit.config.ts",
        dependsOn: ["type-check"],
        cache: {
          env: ["CI", "TZ"],
          output: [],
        },
      },
      "test:integration": {
        command: "vp test run tests/integration",
        dependsOn: ["type-check"],
        cache: false,
      },
      "test:watch": {
        command: "vp test",
        cache: false,
      },
      "test:watch:unit": {
        command: "vp test --config vite.unit.config.ts",
        cache: false,
      },
      "test:watch:integration": {
        command: "vp test tests/integration",
        cache: false,
      },
      lint: {
        command: "vp lint .",
        cache: false,
      },
    },
  },
  pack: {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    deps: {
      neverBundle: [
        "@tsed/core",
        "@tsed/di",
        "@tsed/schema",
        "@tsed/logger",
        "@monque/core",
        "mongodb",
      ],
    },
    publint: true,
    attw: {
      // Validate both ESM and CommonJS consumers.
      profile: "strict",
    },
    unused: {
      enabled: true,
      ignore: ["@tsed/mongoose"],
    },
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
    },
  },
  test: {
    name: "@monque/tsed",
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/integration/helpers/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
