import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const typeCheckTask = "type-check";

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
      "verify:consumer": {
        command: "vp test run --config tests/consumer/vite.config.ts",
        dependsOn: ["build"],
        cache: false,
      },
      clean: {
        command: "rimraf dist",
        cache: false,
      },
      "lint:effect": { command: "effect-tsgo diagnostics --project tsconfig.json", cache: false },
      "type-check": {
        command: "effect-tsgo --tsrs-lint vp lint --type-aware --type-check --deny-warnings",
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
        dependsOn: [typeCheckTask],
        cache: false,
      },
      "test:unit": {
        command: "vp test run tests/unit",
        dependsOn: [typeCheckTask],
        cache: {
          env: ["CI", "TZ"],
          output: [],
        },
      },
      "test:watch": {
        command: "vp test",
        cache: false,
      },
      "test:watch:unit": {
        command: "vp test tests/unit",
        cache: false,
      },
      "test:integration": {
        command: "vp test run tests/integration",
        dependsOn: [typeCheckTask],
        cache: false,
      },
    },
  },
  pack: {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: {
      generator: "tsgo",
      tsgo: { path: fileURLToPath(new URL("../../node_modules/.bin/tsrs", import.meta.url)) },
    },
    clean: true,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    deps: {
      neverBundle: ["@monque/core", "@monque/management", "mongodb"],
    },
    publint: true,
    attw: {
      // Validate both ESM and CommonJS consumers.
      profile: "strict",
      level: "error",
    },
    unused: {
      enabled: true,
      ignore: ["@monque/core", "mongodb"],
    },
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
      "@tests": fileURLToPath(new URL("tests", import.meta.url)),
    },
  },
  test: {
    name: "@monque/management-effect",
    environment: "node",
    include: ["tests/{unit,integration}/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 120_000,
  },
});
