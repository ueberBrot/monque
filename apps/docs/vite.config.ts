import { defineConfig } from "vite-plus";

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
      build: {
        command: "astro build",
        dependsOn: [
          {
            task: "build",
            from: ["dependencies", "devDependencies"],
          },
        ],
        cache: { output: ["dist/**"] },
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
        command: "astro check",
        dependsOn: [
          {
            task: "build",
            from: ["dependencies", "devDependencies"],
          },
        ],
        cache: { output: [".astro/**", "src/content/docs/api*/**"] },
      },
    },
  },
});
