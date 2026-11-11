#!/usr/bin/env node
// twf-tokens — print the token stream tree-sitter produces for one file.
//
//   scripts/twf-tokens.mjs <file> [--named] [--json] [--lang NAME] [--max N]
//   scripts/twf-tokens.mjs --languages
//
// twowayflow has no lexer of its own: the lexing lives inside the generated
// tree-sitter grammar, and the tokens come back as the *leaves* of the concrete
// syntax tree. Every leaf is one token — named ones (`identifier`, `comment`,
// `string_fragment`) from named grammar rules, anonymous ones (`import`, `{`,
// `=>`) from string literals in the grammar. This walks those leaves in source
// order, which is as close to a token stream as tree-sitter hands out.
//
// Offsets are JS string offsets (UTF-16 code units), the same unit as core's
// `Span`, so `source.slice(start, end)` gives the token text back. Lines and
// columns are 1-based; tree-sitter's own Points are 0-based.
//
// Exit codes are a contract:
//   0  tokenized a file that parses cleanly
//   1  usage error — no file, unknown flag, no grammar for this file
//   2  tokenized a file tree-sitter had to recover from (tokens still printed,
//      with the ERROR and MISSING nodes the parser inserted)
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";

const me = basename(process.argv[1] ?? "twf-tokens.mjs");

const die = (message, code = 1) => {
  process.stderr.write(`${me}: ${message}\n`);
  process.exit(code);
};

// web-tree-sitter and the grammars are dependencies of @twowayflow/core, not of the workspace
// root, so resolve them from a require anchored inside that package — the same trick core's
// language.ts uses to survive being bundled into the extension host.
const fromCore = createRequire(new URL("../packages/core/package.json", import.meta.url));

/** The grammar directory, found by resolving the one wasm file language.ts already names. */
function grammarDir() {
  try {
    return dirname(fromCore.resolve("@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm"));
  } catch {
    die("cannot find @vscode/tree-sitter-wasm — run `pnpm install` first");
  }
}

/** Grammar names taken from what is actually on disk, so --languages cannot lie. */
async function installedLanguages() {
  const dir = grammarDir();
  const files = await readdir(dir);
  const names = files
    .filter((f) => f.startsWith("tree-sitter-") && f.endsWith(".wasm"))
    .map((f) => f.slice("tree-sitter-".length, -".wasm".length))
    .sort();
  return { dir, names };
}

// Extension -> grammar name. Only mappings a grammar in the package can actually handle: there
// is no JSON or Markdown grammar here, and asking the TypeScript one to eat JSON just yields a
// tree full of ERROR nodes, which teaches nothing.
const BY_EXTENSION = new Map(
  Object.entries({
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".py": "python",
    ".pyi": "python",
    ".rs": "rust",
    ".go": "go",
    ".rb": "ruby",
    ".java": "java",
    ".cs": "c-sharp",
    ".c": "cpp",
    ".h": "cpp",
    ".cc": "cpp",
    ".cpp": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".css": "css",
    ".sh": "bash",
    ".bash": "bash",
    ".zsh": "bash",
    ".ps1": "powershell",
    ".php": "php",
    ".ini": "ini",
  }),
);

// Interpreter -> grammar name, for the extensionless files in this repo (scripts/twf-diagram).
const BY_INTERPRETER = new Map(
  Object.entries({
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    python: "python",
    python3: "python",
    node: "javascript",
    ruby: "ruby",
    pwsh: "powershell",
    php: "php",
  }),
);

function detectLanguage(file, source) {
  const ext = extname(file).toLowerCase();
  const byExt = BY_EXTENSION.get(ext);
  if (byExt) return { name: byExt, how: `extension ${ext}` };

  const shebang = /^#![^\n]*/.exec(source)?.[0];
  if (shebang) {
    const words = shebang.slice(2).trim().split(/\s+/);
    // `#!/usr/bin/env node` names the interpreter in the second word, `#!/bin/sh` in the first.
    for (const word of words) {
      const interpreter = BY_INTERPRETER.get(basename(word));
      if (interpreter) return { name: interpreter, how: `shebang ${shebang.trim()}` };
    }
  }
  return undefined;
}

async function loadParser(language) {
  const { dir, names } = await installedLanguages();
  if (!names.includes(language)) {
    die(`no grammar named '${language}' — installed: ${names.join(", ")}`);
  }

  // The runtime wasm must be web-tree-sitter's own (the copy in @vscode/tree-sitter-wasm is
  // built against VS Code's emscripten glue), and it sits beside the module that needs it.
  const runtimeWasm = fromCore.resolve("web-tree-sitter/web-tree-sitter.wasm");
  const entry = join(dirname(runtimeWasm), "web-tree-sitter.js");
  const { Language, Parser } = await import(pathToFileURL(entry).href);

  await Parser.init({ locateFile: () => runtimeWasm });
  const grammar = await Language.load(await readFile(join(dir, `tree-sitter-${language}.wasm`)));
  const parser = new Parser();
  parser.setLanguage(grammar);
  return parser;
}

/**
 * Every leaf of the tree, in source order. Walked with a cursor rather than recursion: the
 * cursor stays inside the wasm heap, where recursing through `node.children` would allocate a
 * JS object per node. Descend to the leftmost leaf, emit it, then climb until something has a
 * next sibling — the standard tree-sitter leaf walk.
 */
function* walkLeaves(tree, source) {
  const cursor = tree.walk();
  try {
    for (;;) {
      while (cursor.gotoFirstChild());
      const start = cursor.startIndex;
      const point = cursor.startPosition;
      yield {
        type: cursor.nodeType,
        named: cursor.nodeIsNamed,
        missing: cursor.nodeIsMissing,
        start,
        end: cursor.endIndex,
        row: point.row + 1,
        column: point.column + 1,
        text: source.slice(start, cursor.endIndex),
      };
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return;
      }
    }
  } finally {
    cursor.delete();
  }
}

const show = (token) => {
  if (token.missing) return "<missing>";
  const escaped = token.text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return escaped.length > 48 ? `${escaped.slice(0, 47)}…` : escaped;
};

// Anonymous tokens are quoted, the way tree-sitter prints them in its own S-expressions, so a
// keyword token `import` cannot be confused with a named rule called `import`.
const label = (token) =>
  `${token.named ? token.type : `'${token.type}'`}${token.missing ? " (missing)" : ""}`;

function printTable(shown, total) {
  const columns = shown.map((token, i) => [
    String(i + 1),
    `${token.row}:${token.column}`,
    `${token.start}-${token.end}`,
    label(token),
    show(token),
  ]);
  const header = ["#", "line:col", "offsets", "token", "text"];
  const widths = header.map((head, i) =>
    Math.max(head.length, ...columns.map((row) => row[i].length)),
  );
  const line = (row) =>
    row
      .map((cell, i) => (i === 0 ? cell.padStart(widths[i]) : cell.padEnd(widths[i])))
      .join("  ")
      .trimEnd();

  process.stdout.write(`${line(header)}\n`);
  process.stdout.write(`${widths.map((w) => "-".repeat(w)).join("  ")}\n`);
  for (const row of columns) process.stdout.write(`${line(row)}\n`);
  if (shown.length < total) {
    process.stdout.write(`… ${total - shown.length} more (raise --max to see them)\n`);
  }
}

function printSummary(tokens, meta) {
  const named = tokens.filter((t) => t.named).length;
  const counts = new Map();
  for (const token of tokens) {
    const key = label(token);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([key, n]) => `${key} ${n}`)
    .join(", ");

  process.stdout.write(
    `\n${tokens.length} tokens · ${named} named · ${tokens.length - named} anonymous` +
      ` · ${meta.language} grammar (${meta.how})` +
      ` · ${meta.hasError ? "PARSE ERRORS — recovered" : "parses clean"}\n`,
  );
  process.stdout.write(`most frequent: ${top}\n`);
}

const USAGE = `usage: ${me} <file> [--named] [--json] [--lang NAME] [--max N]
       ${me} --languages

  --named       only tokens from named grammar rules (drops punctuation and keywords)
  --json        machine-readable output instead of the table
  --lang NAME   force a grammar instead of guessing from the extension or shebang
  --max N       print only the first N tokens
  --languages   list the grammars installed with @vscode/tree-sitter-wasm
`;

async function main(argv) {
  let file;
  let language;
  let max;
  let namedOnly = false;
  let json = false;

  const args = argv.slice();
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "-h" || arg === "--help") return process.stdout.write(USAGE);
    if (arg === "--languages") {
      const { names } = await installedLanguages();
      return process.stdout.write(`${names.join("\n")}\n`);
    }
    if (arg === "--named") namedOnly = true;
    else if (arg === "--json") json = true;
    else if (arg === "--lang") {
      language = args.shift() ?? die("--lang needs a grammar name");
    } else if (arg === "--max") {
      max = Number(args.shift());
      if (!Number.isInteger(max) || max < 1) die("--max needs a positive integer");
    } else if (arg.startsWith("-")) die(`unknown flag ${arg}\n${USAGE}`);
    else if (file === undefined) file = arg;
    else die(`one file at a time (already have ${file})\n${USAGE}`);
  }

  if (file === undefined) die(`no file given\n${USAGE}`);

  const source = await readFile(file, "utf8").catch((error) => die(error.message, 1));
  let how = `--lang ${language}`;
  if (language === undefined) {
    const detected = detectLanguage(file, source);
    if (!detected) {
      const { names } = await installedLanguages();
      die(`no grammar guessed for ${file} — pass --lang, one of: ${names.join(", ")}`);
    }
    ({ name: language, how } = detected);
  }

  const parser = await loadParser(language);
  let tokens;
  let hasError;
  try {
    const tree = parser.parse(source);
    if (!tree) die("tree-sitter returned no tree", 2);
    try {
      hasError = tree.rootNode.hasError;
      tokens = [...walkLeaves(tree, source)].filter((token) => !namedOnly || token.named);
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }

  const meta = { file, language, how, hasError };
  const shown = max === undefined ? tokens : tokens.slice(0, max);
  if (json) {
    const payload = { ...meta, tokenCount: tokens.length, truncated: shown.length < tokens.length };
    process.stdout.write(`${JSON.stringify({ ...payload, tokens: shown }, null, 2)}\n`);
  } else if (tokens.length === 0) {
    process.stdout.write(`no tokens — ${file} is empty as far as the ${language} grammar sees\n`);
  } else {
    printTable(shown, tokens.length);
    printSummary(tokens, meta);
  }

  if (hasError) process.exitCode = 2;
}

await main(process.argv.slice(2));
