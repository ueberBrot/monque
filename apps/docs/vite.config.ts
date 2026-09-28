import { defineConfig } from "vite-plus";

// Astro reads CI metadata and its generated state; neither is documentation source.
const untrackedEnv = ["ACTIONS_*", "GITHUB_*", "RUNNER_*"];
const astroInputs = [{ auto: true }, "!**/.astro", "!**/.astro/**"];

export default defineConfig({
  run: {
    tasks: {
      dev: {
        command: "astro dev",
        cache: false,
        dependsOn: [
          {
            task: "build",
            from: ["dependencies", "devDependencies"],
          },
        ],
      },
      start: {
        command: "astro dev",
        cache: false,
      },
      "generate:api": {
        command: "astro sync",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
        cache: {
          untrackedEnv,
          input: [...astroInputs, "!src/content/docs/api*", "!src/content/docs/api*/**"],
          output: ["src/content/docs/api*/**"],
        },
      },
      build: {
        command: "MONQUE_DOCS_REUSE_API=1 astro build",
        dependsOn: ["generate:api"],
        cache: {
          untrackedEnv,
          input: [...astroInputs, "!dist", "!dist/**"],
          output: ["dist/**"],
        },
      },
      preview: {
        command: "astro preview",
        cache: false,
      },
      astro: {
        command: "astro",
        cache: false,
      },
      clean: {
        command: "rimraf dist .astro",
        cache: false,
      },
      "type-check": {
        command: "MONQUE_DOCS_REUSE_API=1 astro check",
        dependsOn: ["generate:api"],
        cache: {
          untrackedEnv,
          input: astroInputs,
          output: [".astro/**"],
        },
      },
    },
  },
});
