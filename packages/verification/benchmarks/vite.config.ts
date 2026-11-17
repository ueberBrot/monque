import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { include: ["benchmarks/tests/**/*.test.ts"], testTimeout: 60_000 },
});
