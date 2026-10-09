import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { z } from "zod";

const packageJson = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf-8")));

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
      "lint:effect": {
        command: "effect-tsgo diagnostics --project tsconfig.json",
        dependsOn: [
          {
            task: "build",
            from: ["dependencies", "devDependencies"],
          },
        ],
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
      "test:watch": {
        command: "vp test",
        cache: false,
      },
      "test:watch:unit": {
        command: "vp test",
        cache: false,
      },
    },
  },
  pack: {
    entry: ["src/index.ts", "src/contract.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node22",
    outDir: "dist",
    deps: {
      neverBundle: ["@monque/core"],
    },
    define: {
      __MONQUE_MANAGEMENT_PACKAGE_VERSION__: JSON.stringify(packageJson.version),
    },
    publint: true,
    attw: {
      // Validate both ESM and CommonJS consumers.
      profile: "strict",
      level: "error",
    },
    unused: {
      enabled: true,
      ignore: ["@monque/core"],
    },
  },

  resolve: {
    alias: {
      "@monque/management/contract": fileURLToPath(new URL("src/contract.ts", import.meta.url)),
      "@": fileURLToPath(new URL("src", import.meta.url)),
      "@tests": fileURLToPath(new URL("tests", import.meta.url)),
    },
  },
  test: {
    name: "@monque/management",
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 5000,
    hookTimeout: 10_000,
  },
});
