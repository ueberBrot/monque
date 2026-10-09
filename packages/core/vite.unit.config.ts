import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
      "@tests": fileURLToPath(new URL("tests", import.meta.url)),
      "@test-utils": fileURLToPath(new URL("tests/setup", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Unit tests don't need MongoDB
    setupFiles: ["./tests/setup/seed.ts"],
    // Shorter timeouts for unit tests
    testTimeout: 5000,
    hookTimeout: 10_000,
  },
});
