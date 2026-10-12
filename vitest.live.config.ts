import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Configuration for the *live* UFOLOAD tests.
 *
 * These talk to the real API with a real key, so they are never part of
 * `npm run test` (the default config excludes `tests/live/**`). Run them
 * deliberately:
 *
 *   LIVE_UFOLOAD=1 UFOLOAD_API_KEY=ufo_... npm run test:live
 *
 * Read `tests/live/README.md` first — one of the tests uploads a file.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/live/**/*.test.ts"],
    // Uploading, encoding and importing are all slow; a single test may wait
    // for the provider for several minutes.
    testTimeout: 15 * 60 * 1000,
    hookTimeout: 60 * 1000,
    fileParallelism: false,
    reporters: "verbose",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@/lib": path.resolve(__dirname, "./lib"),
      "@/src": path.resolve(__dirname, "./src"),
    },
  },
});
