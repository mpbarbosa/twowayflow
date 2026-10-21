import { defineConfig } from "vitest/config";

/**
 * One project per package, so each keeps the config it needs — `packages/vscode-ext` has to
 * alias the `vscode` module, which only exists inside the extension host.
 */
export default defineConfig({
  test: {
    projects: ["packages/*"],
  },
});
