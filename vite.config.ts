import { defineConfig } from "vite-plus";

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
    ignorePatterns: [...ignoredFiles, "specs/**"],
    // Keep Oxlint's default plugins and add its native React checks.
    plugins: ["typescript", "unicorn", "oxc", "react"],
    overrides: [
      { files: ["**/tests/**"], env: { vitest: true } },
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
    projects: ["packages/*/vite.config.ts", "apps/dashboard-dev/vite.config.ts"],
  },
  staged: {
    "*": "vp check --fix",
    "**/package.json": () => "vp install --frozen-lockfile",
  },
});
