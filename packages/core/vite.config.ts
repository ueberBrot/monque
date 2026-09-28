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
        cache: { output: [] },
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
        command: "vp test run integration/",
        dependsOn: ["type-check"],
        cache: false,
      },
      "test:dev": {
        command: "TESTCONTAINERS_REUSE_ENABLE=true vp test",
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
        command: "vp test integration/",
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
      neverBundle: ["mongodb"],
    },
    publint: true,
    attw: {
      // Validate both ESM and CommonJS consumers.
      profile: "strict",
      level: "error",
    },
    unused: true,
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
      "@test-utils": fileURLToPath(new URL("./tests/setup", import.meta.url)),
    },
  },
  test: {
    name: "@monque/core",
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Global setup for MongoDB Testcontainers (returns teardown function)
    globalSetup: ["./tests/setup/global-setup.ts"],
    // Seed faker for deterministic tests
    setupFiles: ["./tests/setup/seed.ts", "./tests/setup/mongodb-cleanup.ts"],
    // Increase timeout for integration tests (container startup can be slow)
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
