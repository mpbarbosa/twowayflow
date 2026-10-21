import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "core",
    include: ["test/**/*.test.ts"],
    // The property tests parse thousands of generated files through a WASM grammar. Raise the
    // run count with TWF_FC_RUNS to hunt harder.
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
