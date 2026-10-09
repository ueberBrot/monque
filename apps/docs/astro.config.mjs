// @ts-check

import { readFileSync, readdirSync } from "node:fs";
import { unified } from "@astrojs/markdown-remark";
import starlight from "@astrojs/starlight";
import astroMermaid from "astro-mermaid";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
import starlightLlmsTxt from "starlight-llms-txt";
import starlightThemeNova from "starlight-theme-nova";
import starlightTypeDoc from "starlight-typedoc";
import { z } from "zod";

const corePackageJsonUrl = new URL("../../packages/core/package.json", import.meta.url);
const parsedPackage = z
  .object({ version: z.string() })
  .safeParse(JSON.parse(readFileSync(corePackageJsonUrl, "utf-8")));
const corePackage = parsedPackage.success ? parsedPackage.data : { version: "unknown" };
const coreVersion = corePackage.version;

const apiReferences = [
  { package: "core", output: "api", label: "Core API" },
  { package: "tsed", output: "api-tsed", label: "Ts.ED API" },
  { package: "management", output: "api-management", label: "Management API" },
  {
    package: "management-express",
    output: "api-management-express",
    label: "Management Express API",
  },
  { package: "dashboard", output: "api-dashboard", label: "Dashboard API" },
  { package: "dashboard-express", output: "api-dashboard-express", label: "Dashboard Express API" },
];
const reuseApi = process.env.MONQUE_DOCS_REUSE_API === "1";
if (reuseApi) {
  for (const { output } of apiReferences) {
    const directory = new URL(`src/content/docs/${output}/`, import.meta.url);
    if (
      !readdirSync(directory, { recursive: true, encoding: "utf-8" }).some((file) =>
        file.endsWith(".md"),
      )
    ) {
      throw new Error(
        `Missing generated documentation in ${output}; run vp run generate:api first.`,
      );
    }
  }
}

// https://astro.build/config
export default defineConfig({
  compressHTML: true,
  vite: {
    environments: {
      prerender: {
        resolve: {
          external: ["satteri"],
        },
      },
    },
    define: {
      __MONQUE_CORE_VERSION__: JSON.stringify(coreVersion),
    },
  },
  markdown: {
    processor: unified(),
  },
  site: "https://ueberBrot.github.io",
  base: "/monque",
  integrations: [
    astroMermaid(),
    starlight({
      title: "Monque",
      description:
        "A MongoDB-backed job scheduler for Node.js with atomic locking, exponential backoff, cron scheduling, and event-driven observability.",
      components: {
        SiteTitle: "./src/components/site-title.astro",
      },
      logo: {
        src: "./src/assets/icon.svg",
        replacesTitle: false,
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/ueberbrot/monque" }],
      editLink: {
        baseUrl: "https://github.com/ueberbrot/monque/edit/main/apps/docs/",
      },
      lastUpdated: true,
      customCss: [
        "@fontsource/quicksand/400.css",
        "@fontsource/quicksand/500.css",
        "@fontsource/quicksand/600.css",
        "@fontsource/quicksand/700.css",
        "./src/styles/custom.css",
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quick Start", slug: "getting-started/quick-start" },
          ],
        },
        {
          label: "Core Concepts",
          items: [
            { label: "Jobs", slug: "core-concepts/jobs" },
            { label: "Workers", slug: "core-concepts/workers" },
            { label: "Scheduling", slug: "core-concepts/scheduling" },
            { label: "Retry & Backoff", slug: "core-concepts/retry" },
            { label: "Job Management", slug: "core-concepts/management" },
          ],
        },
        {
          label: "Management",
          items: [
            { label: "Management API", slug: "management/surface" },
            { label: "Express Adapter", slug: "management/express" },
          ],
        },
        {
          label: "Dashboard",
          items: [
            { label: "Express Setup", slug: "dashboard/express" },
            { label: "Configuration", slug: "dashboard/configuration" },
            { label: "Screenshots", slug: "dashboard/screenshots" },
          ],
        },
        {
          label: "Advanced",
          items: [
            { label: "Atomic Claim Pattern", slug: "advanced/atomic-claim" },
            { label: "Change Streams", slug: "advanced/change-streams" },
            { label: "Heartbeat Mechanism", slug: "advanced/heartbeat" },
            { label: "Production Checklist", slug: "advanced/production-checklist" },
          ],
        },
        {
          label: "Integrations",
          items: [{ label: "Ts.ED", slug: "integrations/tsed" }],
        },
        {
          label: "Roadmap",
          slug: "roadmap",
        },
        {
          label: "API Reference",
          items: apiReferences.map(({ output, label }) => ({
            label,
            collapsed: true,
            items: [{ autogenerate: { directory: output, collapsed: true } }],
          })),
        },
      ],
      head: [
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://ueberBrot.github.io/monque/favicon.svg",
          },
        },
      ],
      plugins: [
        starlightLlmsTxt(),
        starlightThemeNova(),
        starlightLinksValidator({
          errorOnRelativeLinks: true,
        }),
        ...(reuseApi
          ? []
          : apiReferences.map(({ package: name, output, label }) =>
              starlightTypeDoc({
                entryPoints: [`../../packages/${name}/src/index.ts`],
                tsconfig: `../../packages/${name}/tsconfig.json`,
                output,
                sidebar: { label, collapsed: true },
                typeDoc: {
                  excludePrivate: true,
                  excludeProtected: true,
                  excludeInternal: true,
                  readme: "none",
                  parametersFormat: "table",
                  enumMembersFormat: "table",
                  useCodeBlocks: true,
                  gitRevision: "main",
                },
              }),
            )),
      ],
    }),
  ],
});
