import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { include: ["scripts/benchmarks/tests/**/*.test.ts"], testTimeout: 60_000 },
});
