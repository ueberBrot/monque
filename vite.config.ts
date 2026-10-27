import { strict as effectStrict } from "@effect/tsgo/oxlint-presets";
import ultraciteAntiSlop from "ultracite/oxlint/anti-slop";
import ultraciteCore from "ultracite/oxlint/core";
import { selectJsPlugins } from "ultracite/oxlint/js-plugins";
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
const sonarJs = selectJsPlugins(["sonarjs"]);

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
        // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- Import sorting recognizes HTTP and HTTPS URL specifiers.
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
    env: ultraciteCore.env,
    extends: [
      ultraciteCore,
      ultraciteTanstack,
      ultraciteAntiSlop,
      effectStrict,
      vitestPreset,
      sonarJs,
    ],
    jsPlugins: [...(ultraciteAntiSlop.jsPlugins ?? []), ...(sonarJs.jsPlugins ?? [])],
    ignorePatterns: [...(ultraciteCore.ignorePatterns ?? []), ...ignoredFiles, "specs/**"],
    // CI runs native rules before builds, then typed lint and TypeScript together.
    options: { typeAware: false },
    rules: {
      // Public Promise<void> and Effect fiber APIs use void generic arguments.
      "typescript/no-invalid-void-type": ["error", { allowInGenericTypeArguments: true }],
      // Promise adapters preserve arbitrary third-party rejection values in the error channel.
      "effecttsgo/any-unknown-in-error-context": "off",
    },
    overrides: [
      {
        files: ["**/tests/**"],
        env: { vitest: true },
        // Fixtures and exact assertions distinguish undefined from null and absent keys.
        rules: { "sonarjs/no-undefined-assignment": "off" },
      },
      {
        files: [
          "apps/dashboard-dev/tests/unit/dev-shell-environment.test.ts",
          "apps/dashboard-dev/tests/unit/local-db-lifecycle.test.ts",
          "apps/dashboard-dev/tests/unit/mock-management-fetch.test.ts",
          "packages/dashboard-express/tests/unit/dashboard-express-router.test.ts",
          "packages/dashboard/tests/unit/command-menu.test.tsx",
          "packages/management/tests/unit/contract-subpath-export.test.ts",
          "packages/tsed/tests/unit/monque-module.test.ts",
        ],
        // Module seam tests need typeof the whole module, and export tests enumerate its namespace.
        rules: { "sonarjs/no-wildcard-import": "off" },
      },
      {
        files: [
          "packages/core/src/scheduler/monque.ts",
          "packages/core/src/scheduler/types.ts",
          "packages/dashboard/src/components/processing-controls.tsx",
          "packages/dashboard/src/components/ui/calendar.tsx",
          "packages/dashboard/src/routes/-queue-views.shared.tsx",
          "packages/management/src/surface/action-policy.ts",
          "packages/management/src/surface/types.ts",
          "packages/management/tests/unit/management-test-utils.ts",
        ],
        // Explicit undefined remains assignable for consumers using exactOptionalPropertyTypes.
        rules: { "sonarjs/no-redundant-optional": "off" },
      },
      {
        files: [
          "packages/core/src/scheduler/services/job-processor.ts",
          "packages/core/src/scheduler/services/pending-notification-router.ts",
          "packages/dashboard/src/features/jobs/job-action-dialog.tsx",
          "packages/dashboard/src/features/jobs/job-actions.ts",
          "packages/dashboard/src/features/jobs/jobs-filters.tsx",
          "packages/dashboard/src/lib/document-visibility.ts",
          "packages/dashboard/src/lib/use-now.ts",
          "packages/dashboard/src/management-errors.ts",
          "packages/dashboard/src/routes/jobs.tsx",
        ],
        // Undefined clears optional state, timers, and search parameters; null has different semantics.
        rules: { "sonarjs/no-undefined-assignment": "off" },
      },
      {
        files: [
          "packages/core/tests/unit/services/cursor-listing.test.ts",
          "packages/core/tests/unit/services/job-intake.test.ts",
          "packages/core/tests/unit/services/job-lifecycle.test.ts",
          "packages/core/tests/unit/services/job-manager.test.ts",
          "packages/core/tests/unit/services/job-processor.test.ts",
          "packages/core/tests/unit/services/job-query.test.ts",
        ],
        // SonarJS's fixed test-call list does not recognize @effect/vitest's it.effect.
        rules: { "sonarjs/no-empty-test-file": "off" },
      },
      {
        files: ["packages/tsed/tests/integration/*.test.ts"],
        // Controller fixture statics record execution and are reset between tests.
        rules: { "sonarjs/public-static-readonly": "off" },
      },
      {
        files: ["**/*.tsx"],
        // React components use PascalCase, including functions returning conditional JSX.
        rules: { "sonarjs/function-name": ["error", { format: "^[_a-zA-Z][a-zA-Z0-9]*$" }] },
      },
      {
        files: ["**/*.astro"],
        // The JS bridge cannot see imports referenced by the Astro template.
        rules: { "sonarjs/unused-import": "off" },
      },
      {
        files: ["packages/core/src/**/*.ts", "packages/management/src/**/*.ts"],
        // Keep unstable Effect types out of published APIs.
        rules: { "effecttsgo/api-stability-leak": "error" },
      },
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
