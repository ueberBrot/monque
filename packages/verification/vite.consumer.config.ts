import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    name: "@monque/verification-consumer",
    include: ["consumer.test.mts"],
    testTimeout: 600_000,
  },
});
