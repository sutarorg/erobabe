import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    exclude: ["node_modules", "tests/e2e/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@/lib": path.resolve(__dirname, "./lib"),
      "@/src": path.resolve(__dirname, "./src"),
    },
  },
});
