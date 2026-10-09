import { strict as effectStrict } from "@effect/tsgo/oxlint-presets";
import ultraciteAntiSlop from "ultracite/oxlint/anti-slop";
import ultraciteCore from "ultracite/oxlint/core";
import ultraciteReact from "ultracite/oxlint/react";
import ultraciteTanstack from "ultracite/oxlint/tanstack";
import ultraciteVitest from "ultracite/oxlint/vitest";
import { defineConfig } from "vite-plus";
import type { OxlintConfig } from "vite-plus/lint";

const ignoredFiles = [
  "**/dist/**",
  "**/.astro/**",
  "**/.vitest/**",
  "**/.agents/**",
  "**/.opencode/**",
  "**/routeTree.gen.ts",
  "**/playwright-report/**",
  "**/test-results/**",
  "apps/docs/src/content/docs/api*/**",
];

const effectTestBlocks = ["it.effect", "it.live", "it.scoped", "it.scopedLive"];
const vitestPreset: OxlintConfig = {
  ...ultraciteVitest,
  overrides: (ultraciteVitest.overrides ?? []).map((override) => ({
    ...override,
    // Playwright owns .spec files; Vitest owns .test files in this repository.
    files: ["**/*.test.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
    rules: {
      ...override.rules,
      // Vitest supports an optional assertion diagnostic message.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "vitest/expect-expect": [
        "error",
        {
          additionalTestBlockFunctions: effectTestBlocks,
          assertFunctionNames: ["expect", "expectJsonResponse"],
        },
      ],
      "vitest/no-standalone-expect": [
        "error",
        {
          additionalTestBlockFunctions: [
            ...effectTestBlocks,
            "it.effect.each",
            "it.live.each",
            "Effect.gen",
          ],
        },
      ],
      // Preserve exact boolean assertions instead of replacing them with truthiness.
      "vitest/prefer-strict-boolean-matchers": "error",
      "vitest/prefer-to-be-truthy": "off",
      "vitest/prefer-to-be-falsy": "off",
    },
  })),
};

export default defineConfig({
  fmt: {
    ignorePatterns: [...ignoredFiles, "bun.lock"],
    sortImports: {
      newlinesBetween: false,
      internalPattern: ["@/", "@tests/", "@test-utils/"],
      customGroups: [
        { groupName: "url", elementNamePattern: ["https://**", "http://**"] },
        { groupName: "protocol", elementNamePattern: ["node:*", "bun:*", "npm:*"] },
      ],
      groups: [
        "url",
        ["protocol", "builtin"],
        ["external"],
        { newlinesBetween: true },
        "internal",
        { newlinesBetween: true },
        ["parent", "sibling", "index"],
        "subpath",
        "unknown",
      ],
    },
  },
  lint: {
    extends: [ultraciteCore, ultraciteTanstack, ultraciteAntiSlop, effectStrict, vitestPreset],
    jsPlugins: ultraciteAntiSlop.jsPlugins,
    ignorePatterns: [...(ultraciteCore.ignorePatterns ?? []), ...ignoredFiles, "specs/**"],
    // CI runs native rules before builds, then typed lint and TypeScript together.
    options: { typeAware: false },
    rules: {
      // Keep required arguments in typed APIs such as Deferred.succeed and Vitest
      // mocks; the rule cannot distinguish them from optional JS arguments.
      "unicorn/no-useless-undefined": ["error", { checkArguments: false }],
      // Public Promise<void> and Effect fiber APIs use void generic arguments.
      "typescript/no-invalid-void-type": ["error", { allowInGenericTypeArguments: true }],
      // This default-off diagnostic is absent from Effect's strict preset. Monque's
      // Promise adapters preserve arbitrary rejection values as part of their API.
      "effecttsgo/any-unknown-in-error-context": "off",
    },
    overrides: [
      { files: ["**/tests/**"], env: { vitest: true } },
      {
        files: ["packages/dashboard/**/*.{ts,tsx}", "apps/dashboard-dev/**/*.{ts,tsx}"],
        ...ultraciteReact,
      },
      {
        files: ["packages/core/src/scheduler/effects.ts", "packages/management/src/effects.ts"],
        rules: {
          // These boundaries must preserve unknown third-party rejection values.
          "effecttsgo/unknown-in-effect-catch": "off",
        },
      },
      {
        files: [
          "packages/core/src/scheduler/monque.ts",
          "packages/core/src/scheduler/services/cursor-listing.ts",
          "packages/core/src/scheduler/services/job-intake.ts",
          "packages/core/src/scheduler/services/job-lifecycle.ts",
          "packages/core/src/scheduler/services/job-query.ts",
          "packages/core/tests/unit/services/job-processor.test.ts",
        ],
        rules: {
          // Preserve the existing public native error classes at the API boundary.
          "effecttsgo/global-error-in-effect-failure": "off",
        },
      },
      {
        files: ["packages/dashboard/src/**/*.{ts,tsx}", "apps/dashboard-dev/src/**/*.{ts,tsx}"],
        excludeFiles: ["**/components/ui/**", "**/routeTree.gen.ts"],
        jsPlugins: ["@shadcn/lint"],
        rules: { "shadcn/no-unknown-classes": "error" },
      },
    ],
  },
  run: {
    tasks: {
      "release:publish": {
        // Build publishable packages only when Changesets takes its publish path.
        command: "vp run --filter './packages/*' build && vp exec changeset publish",
        cache: false,
      },
      "release:version": {
        command: "vp exec changeset version && vp install --lockfile-only --ignore-scripts",
        cache: false,
      },
      "changeset:renovate": {
        command: "bun scripts/renovate-generate-changeset.ts",
        cache: false,
      },
      "lint:api-links": {
        command: "bun scripts/validate-api-links.ts",
        cache: false,
      },
      "check:unused": { command: "knip", cache: false },
      analyze: { command: "fallow", cache: false },
      "analyze:unused": { command: "fallow dead-code", cache: false },
      "analyze:dupes": { command: "fallow dupes", cache: false },
      "analyze:health": { command: "fallow health --hotspots --targets", cache: false },
      "analyze:changes": { command: "fallow audit", cache: false },
      sandcastle: { command: "bun .sandcastle/main.ts", cache: false },
      reset: {
        command: "rimraf --glob '**/node_modules' '**/dist' '**/.astro' '**/.vitest'",
        cache: false,
      },
    },
  },
  test: {
    projects: [
      "packages/*/vite.config.ts",
      "apps/dashboard-dev/vite.config.ts",
      { test: { name: "ci", include: ["scripts/ci/tests/**/*.test.ts"] } },
    ],
  },
  staged: {
    "*": "vp fmt",
    // Typed linting needs full project context, even when only one file is staged.
    "*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}": () => "vp run lint:fix",
    "**/package.json": () => "vp install --frozen-lockfile",
  },
});
