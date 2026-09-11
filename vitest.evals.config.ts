import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    // A single agent round-trip to the Hugging Face endpoint is slow.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
