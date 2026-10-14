import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // tsconfig sets jsx: "preserve" for Next.js; component tests need real JSX.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // `tests/live/**` needs real external-service credentials — see tests/live/README.md.
    exclude: ["node_modules", "tests/e2e/**", "tests/live/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./"),
      "@/lib": path.resolve(import.meta.dirname, "./lib"),
      "@/src": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
