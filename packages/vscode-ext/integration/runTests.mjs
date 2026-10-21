import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

/**
 * Downloads a VS Code build into `.vscode-test/` on first run and launches it with this
 * extension loaded, using `examples/` as the workspace.
 *
 * Not part of `pnpm test`: it needs the network the first time and a display (use `xvfb-run`
 * on a headless machine). `pnpm test:integration` runs it.
 */
const here = fileURLToPath(new URL(".", import.meta.url));

await runTests({
  extensionDevelopmentPath: fileURLToPath(new URL("..", import.meta.url)),
  extensionTestsPath: `${here}../dist-integration/suite.cjs`,
  launchArgs: [
    fileURLToPath(new URL("../../../examples", import.meta.url)),
    "--disable-extensions",
    "--disable-gpu",
  ],
});
