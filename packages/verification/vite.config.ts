import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      "verify:consumer": {
        command: "vp test run --config vite.consumer.config.ts",
        dependsOn: [{ task: "build", from: ["dependencies", "devDependencies"] }],
        cache: false,
      },
      benchmark: {
        command: "bun benchmarks/run.mts",
        dependsOn: ["@monque/management#build"],
        cache: false,
      },
      "test:benchmark": {
        command: "vp test run --config benchmarks/vite.config.ts",
        dependsOn: ["@monque/management#build"],
        cache: false,
      },
    },
  },
  test: { name: "@monque/verification", include: [] },
});
