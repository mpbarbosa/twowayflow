import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";

export interface LanguageOptions {
  /** Override the path to `tree-sitter-typescript.wasm`. */
  readonly languageWasmPath?: string;
  /**
   * Override the path to web-tree-sitter's own `tree-sitter.wasm` runtime. Needed only when
   * the module is bundled somewhere its sibling WASM file cannot be found.
   */
  readonly runtimeWasmPath?: string;
}

let ready: Promise<Parser> | undefined;

function resolveDefault(specifier: string): string {
  // `createRequire` rather than `import.meta.resolve` so this keeps working when the extension
  // host bundles the module, as long as web-tree-sitter stays external. In a CommonJS bundle
  // `import.meta.url` is not available, so fall back to `__filename`; `typeof` on an
  // undeclared identifier is safe, which is what makes the same expression work in both.
  const base = typeof __filename === "string" ? __filename : import.meta.url;
  return createRequire(base).resolve(specifier);
}

/**
 * Initialise tree-sitter and load the TypeScript grammar. Idempotent: the WASM runtime can only
 * be initialised once per process, and the grammar is ~1.3 MB, so both are cached.
 */
export async function getParser(options: LanguageOptions = {}): Promise<Parser> {
  if (!ready) {
    ready = (async () => {
      // The runtime WASM must be web-tree-sitter's own: the copy shipped in
      // @vscode/tree-sitter-wasm is built against VS Code's emscripten glue and fails to link
      // against this one. Only the *grammar* is taken from that package.
      await Parser.init(
        options.runtimeWasmPath ? { locateFile: () => options.runtimeWasmPath! } : undefined,
      );

      const languageWasmPath =
        options.languageWasmPath ??
        resolveDefault("@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm");
      const language = await Language.load(await readFile(languageWasmPath));

      const parser = new Parser();
      parser.setLanguage(language);
      return parser;
    })().catch((error) => {
      // Don't cache a failed init, or every later call reports a stale error.
      ready = undefined;
      throw error;
    });
  }
  return ready;
}
