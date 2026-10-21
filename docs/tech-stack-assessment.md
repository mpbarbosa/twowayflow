# twowayflow — Tech Stack Assessment

**Date:** 2026-10-20
**Status:** Recommendation, pending validation by a round-trip spike
**Scope:** Greenfield. At time of writing the repo contains only a one-line README and an MIT license.

---

## 1. The constraint that decides the stack

Round-trip design↔code is a graveyard: Rational Rose, Together/J, Enterprise Architect,
Dreamweaver's WYSIWYG↔HTML. They all died the same death — the design view held *its own*
persisted model, so regenerating code clobbered hand edits, and parsing code back could not
recover intent that was never in the code.

The tools that survived (SwiftUI previews, Jetpack Compose, Onlook, Builder.io) all made one
choice:

> **Code on disk is the only source of truth, and the canvas is an editable projection over
> its syntax tree.**

Design edits are *surgical AST patches*, not regeneration. Then "code → design" is free
(re-parse) and "design → code" is a small diff.

**Corollary:** if twowayflow ever ships a `.twf` model file next to the source, it has already
lost. Every choice below follows from rejecting that.

---

## 2. Confirmed scope

The design side represents **dataflow / pipeline graphs** — nodes are computation steps,
edges are data moving between them. This was confirmed with the project owner and it drives
the canvas and DSL choices in §3.

---

## 3. Recommended stack

| Layer | Pick | Why |
|---|---|---|
| **Shell (v1)** | VS Code extension — webview canvas + extension host | Free file watching, git, LSP, terminal, debugger, distribution, user trust. Building an IDE shell first is the #1 way to spend two years and ship nothing. |
| **Shell (v2)** | Tauri 2 | Same Rust core you already have, ~10 MB vs Electron's ~150 MB, native webview. Electron only if you need Chromium-identical rendering. |
| **Core engine** | Rust | Parsing + patching is hot-path work on every keystroke; also compiles to WASM so the same engine runs in the webview, the CLI, and CI. |
| **Parsing** | **tree-sitter** (CST, error-tolerant, incremental) | The CST preserves comments and whitespace. Non-negotiable: you patch *byte ranges*, you never pretty-print the whole file back. |
| **JS/TS semantics** | `oxc` (or `swc`) alongside tree-sitter | For scope/binding resolution, not just syntax. Use its codegen only for *newly generated* nodes, never to rewrite existing ones. |
| **Design model** | A typed **TypeScript eDSL** in the repo (`*.flow.ts`) | The file *is* the design and *is* executable, type-checked, refactorable, git-diffable code. Round-trip becomes near-free. Importing arbitrary existing code is a v2 problem. |
| **Canvas** | `@xyflow/react` (React Flow, MIT) | Pan/zoom, edges, handles, minimap, selection — all solved. Custom SVG only if node shapes are genuinely exotic. |
| **Code pane** | Monaco | VS Code-grade IntelliSense in a code-first IDE. CodeMirror 6 wins only if code appears as many tiny inline editors. |
| **UI** | TypeScript + React + Zustand/Immer | Ecosystem depth around the canvas libs. Keep canvas state *derived* from the parse, never a parallel copy. |
| **Language intel** | LSP (tsserver / `tsgo`) | Reuse, don't reimplement. Free inside VS Code. |
| **Formatting** | dprint or Biome, deterministic, on every write | Stable output keeps git diffs tiny and round-trips lossless. |
| **Monorepo** | pnpm + Turborepo, cargo workspace | `core-rs` / `dsl` / `canvas-ui` / `vscode-ext`. |
| **Tests** | Vitest + Playwright, **plus property-based round-trip tests** (`proptest`, `fast-check`) | See §4. |

---

## 4. The two things that actually make or break it

### 4.1 Span provenance

Every canvas node must carry a byte range back into its source file, maintained
**incrementally** as the file changes. Click a node → highlight the code. Edit the code → the
node moves, it does not get destroyed and recreated.

Get this wrong and selection sync, undo, and multi-cursor all break in ways that cannot be
retrofitted.

### 4.2 Round-trip invariants as the primary test suite

Property tests asserting:

- `print(parse(src)) == src` — byte-for-byte, over a corpus of real-world files
- `parse(patch(src, edit))` ≡ `apply(parse(src), edit)`

**This suite is the product.** If it is green, the IDE works. Without it, twowayflow will ship
something that silently eats people's comments.

---

## 5. Explicitly rejected

- **Eclipse EMF / Sirius, or the JetBrains platform** — heavyweight, wrong era, tiny
  contributor pool.
- **CRDTs for canonical state** — text files plus git already are the CRDT. Add Yjs/Loro only
  when real-time multiplayer arrives.
- **Full-file code generation from the model** — this is the specific mechanism by which every
  predecessor tool died.
- **A "Sync" button** — sync must be continuous and incremental, or users stop trusting it by
  day two.

---

## 6. Thinnest credible v1

VS Code extension → tree-sitter parse of `*.flow.ts` → React Flow canvas in a webview → drag a
node, emit a ranged text edit through the workspace API → re-parse → canvas updates.

One language, one DSL, bidirectional, under ~3k lines. Everything else is expansion.

---

## 7. Immediate next step

Design the eDSL's **surface syntax** before writing any other code. It is simultaneously the
file format, the public API, and the thing the canvas patches. A graph expressed as chained
builder calls patches cleanly; one expressed as a nested object literal with inferred edges
does not.

Then build the spike in §6 and let the §4.2 property tests decide whether byte-range patching
is sound enough to build a product on. A negative result there is a valuable result.
