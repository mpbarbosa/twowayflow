# twowayflow

IDE for design and development of computational solutions, supporting a two-way workflow:
design → code and code → design.

The design domain is **dataflow / pipeline graphs**: nodes are computation steps, edges are data
moving between them.

## The one architectural rule

> **Code on disk is the only source of truth. The canvas is an editable projection over its
> syntax tree.**

Every round-trip design/code tool that died — Rational Rose, Together/J, Dreamweaver's WYSIWYG —
died the same way: the design view persisted *its own* model, so regenerating code clobbered hand
edits. twowayflow has no `.twf` file, no sidecar, no parallel model. A `*.flow.ts` file **is** the
design. Canvas gestures become **surgical byte-range text patches** against that file. Never a
regeneration, never a reformat.

The reasoning is in [docs/tech-stack-assessment.md](docs/tech-stack-assessment.md); the current
state of the evidence is in [docs/spike-findings.md](docs/spike-findings.md).

## Status

**v1 round-trip spike.** The parse/patch core and its property-test suite are the real
deliverable; the VS Code extension is a working demonstration of the loop, not a product.

## Layout

| Package | What it is |
|---|---|
| [`packages/dsl`](packages/dsl) | The `*.flow.ts` embedded DSL — a typed chained builder. The file format and the public API. |
| [`packages/core`](packages/core) | tree-sitter parse into a graph where everything carries its source span, plus the patch API that turns canvas ops into ranged text edits. |
| [`packages/vscode-ext`](packages/vscode-ext) | VS Code extension: a `@xyflow/react` canvas in a webview, synced continuously with the text editor. |
| [`examples/`](examples) | Two worked `.flow.ts` files, both synthetic. The projections of a real sibling project now live in that project, under its own `docs/twowayflow/`. |
| [`docs/dsl.md`](docs/dsl.md) | The DSL surface syntax, and why it is patchable. |

## Getting started

```bash
pnpm install && pnpm test
```

That runs everything that does not need a display: unit tests, the hostile fixtures, and the
property-based round-trip suite.

To hunt harder with the property tests (the default is 150 runs per property):

```bash
TWF_FC_RUNS=12000 pnpm test
```

Other scripts:

```bash
pnpm run typecheck && pnpm run lint:biome && pnpm run build
```

### Trying the extension

Open this repo in VS Code and press <kbd>F5</kbd> ("Run twowayflow extension"). In the new
window, open `examples/orders-etl.flow.ts` and run **twowayflow: Open Flow Canvas** from the
editor title bar or the command palette.

Drag a node and watch the `at: [x, y]` in the source change — and nothing else. Edit the file and
watch the canvas follow. Put the cursor in a `.node(...)` line and the matching node highlights.
There is no Sync button, by design.

There is also a real extension-host integration test, which needs a display (or `xvfb-run`) and
downloads a VS Code build on first use:

```bash
pnpm run test:integration
```
