import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");
const require = createRequire(import.meta.url);

/**
 * The extension host loads two WASM files at runtime: web-tree-sitter's own runtime and the
 * TypeScript grammar. Both are copied into `dist/` and addressed by absolute path, so the
 * extension does not depend on node_modules being present beside it.
 */
async function copyWasm() {
  await mkdir("dist", { recursive: true });
  const files = [
    ["web-tree-sitter/web-tree-sitter.wasm", "dist/web-tree-sitter.wasm"],
    [
      "@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm",
      "dist/tree-sitter-typescript.wasm",
    ],
  ];
  for (const [specifier, target] of files) {
    await cp(require.resolve(specifier), target);
  }
}

/**
 * Two bundles.
 *
 * The extension host runs in Node and keeps `vscode` and `web-tree-sitter` external: `vscode`
 * because the host provides it, and web-tree-sitter because its emscripten glue resolves its
 * own files at runtime and bundling it breaks that. `import.meta.url` is defined to
 * `__filename` so the core package's `createRequire` fallback still works in the CJS output.
 *
 * The webview is a browser bundle with React and @xyflow/react inlined.
 */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: ["vscode", "web-tree-sitter"],
  define: { "import.meta.url": "__filename" },
  logLevel: "info",
};

const webviewConfig = {
  entryPoints: ["webview/main.tsx"],
  outfile: "dist/webview.js",
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  sourcemap: true,
  jsx: "automatic",
  loader: { ".css": "css" },
  logLevel: "info",
};

/** Bundled separately: only `pnpm test:integration` builds and runs it. */
const integrationConfig = {
  entryPoints: ["integration/suite.ts"],
  outfile: "dist-integration/suite.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: ["vscode", "web-tree-sitter"],
  define: { "import.meta.url": "__filename" },
  logLevel: "info",
};

await copyWasm();

if (process.argv.includes("--integration")) {
  await build(integrationConfig);
} else if (watch) {
  const contexts = await Promise.all([context(extensionConfig), context(webviewConfig)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("twowayflow: watching");
} else {
  await Promise.all([build(extensionConfig), build(webviewConfig)]);
}
