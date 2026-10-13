import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Configuration for the *live* provider tests (Streamtape + OpenRouter).
 *
 * They talk to real APIs with real credentials, so they are never part of
 * `npm run test` (the default config excludes `tests/live/**`). Run them
 * deliberately:
 *
 *   LIVE_STREAMTAPE=1 STREAMTAPE_LOGIN=... STREAMTAPE_API_KEY=... npm run test:live
 *   NEXT_PUBLIC_OPENROUTER_API_KEY=sk-or-… npm run test:live
 *
 * Read `tests/live/README.md` first — one of the Streamtape tests uploads a
 * file, and the OpenRouter test needs outbound HTTPS to openrouter.ai.
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
