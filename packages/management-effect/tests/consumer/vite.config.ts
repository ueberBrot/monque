import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    name: "@monque/management-effect-consumer",
    include: ["tests/consumer/verify.test.mts"],
    testTimeout: 120_000,
  },
});
