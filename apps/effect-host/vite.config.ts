import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      start: {
        command: "bun src/main.ts",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
        cache: false,
      },
      test: {
        command: "vp test run",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
        cache: false,
      },
      "lint:effect": {
        command: "effect-tsgo diagnostics --project tsconfig.json",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
        cache: false,
      },
    },
  },
  test: {
    name: "@monque/effect-host",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
