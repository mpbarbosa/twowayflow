import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `vscode` is only available inside the extension host, so the loop test aliases it to an
 * in-memory stub. This config exists solely so `packages/vscode-ext` can be tested at all.
 */
export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL("./test/vscode-stub.ts", import.meta.url)),
    },
  },
  test: {
    name: "vscode-ext",
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
