import { defineConfig } from "vite-plus";

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
          input: [...astroInputs, "!src/content/docs/api*", "!src/content/docs/api*/**"],
          output: ["src/content/docs/api*/**"],
        },
      },
      build: {
        command: "MONQUE_DOCS_REUSE_API=1 astro build",
        dependsOn: ["generate:api"],
        cache: {
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
          input: astroInputs,
          output: [".astro/**"],
        },
      },
    },
  },
});
