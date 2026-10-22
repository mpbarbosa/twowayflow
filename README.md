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
| [`examples/`](examples) | Four worked `.flow.ts` files — two synthetic, two projected from a real sibling project. |
| [`docs/dsl.md`](docs/dsl.md) | The DSL surface syntax, and why it is patchable. |
| [`scripts/twf-diagram`](scripts/twf-diagram) | The mechanical half of landing a diagram in a project you explored: the branch, the titleblock, the folder index row, the commit, the push and the PR. |
| [`scripts/twf-install`](scripts/twf-install) | Package this extension into a `.vsix`, install it in VS Code, and check the editor actually lists it. |

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

To install it into your own VS Code instead of running it from <kbd>F5</kbd>:

```bash
scripts/twf-install
```

That packages the extension and installs it with `--force` — the manifest's version never
changes, so without that VS Code keeps the copy it already has and says nothing — and then asks
the editor what it lists, because `--install-extension` exits `0` for an extension VS Code will
not show. `--code CMD` picks another editor CLI, `--vsix PATH` installs a file you already have,
and `--package-only` just writes the `.vsix` and prints its path. Reload the window afterwards:
a replaced extension is not picked up while the editor is running.

There is also a real extension-host integration test, which needs a display (or `xvfb-run`) and
downloads a VS Code build on first use:

```bash
pnpm run test:integration
```

## Landing a diagram in a project you explored

Everything produced by exploring a project with twowayflow belongs in **that project**, under
its own `docs/twowayflow/`, on a branch of its own, carrying a titleblock that names the
diagram, its type, the project and what it shows — so it stays readable when pulled out of the
repository it describes.

[`scripts/twf-diagram`](scripts/twf-diagram) does that ritual. The judgement — which notation,
what claim it has to carry, whether it is worth drawing at all — is yours.

```bash
scripts/twf-diagram start ~/src/their-project turno-sequencia \
  --title 'One turn in time' --type 'Sequence diagram — Mermaid' \
  --desc 'One turn of POST /api/perguntar in time: the lock, and the guard that runs after its own fragments have left.'
```

That creates `docs/twowayflow-turno-sequencia` from the project's default branch and writes a
skeleton with the titleblock filled in. Write the diagram into it, then:

```bash
scripts/twf-diagram lint ~/src/their-project
scripts/twf-diagram land ~/src/their-project turno-sequencia -m "O turno em tempo" --pr
```

`land` refuses a titleblock missing a field or a body still carrying the skeleton marker, adds
the row to that folder's `README.md` index, commits only the two paths it named, pushes the
branch by name, and checks the server agrees before saying so. Pass `--attribution` to add the
Claude Code trailer to the commit and the pull request.

Running it again is safe and is how you finish a run that failed halfway: with nothing new to
commit it still pushes and still opens the pull request. If the index row no longer matches the
titleblock it says so and leaves the row alone, because that row is prose someone may have
improved by hand.

Because each diagram branches from the default branch, two in flight will both add a row to the
index table and conflict there on merge. Take both rows.

Exit codes are a contract: `0` did what was asked, `1` a usage error or a lint failure, `2`
something a person must look at — a dirty tree, the wrong branch, an index holding paths the
command did not name, or a push that did not land.

### Asking for one from VS Code

That request is a sentence, so the extension can write it for you. Run **twowayflow: New Diagram
Request** from the command palette: it asks which project the diagram describes, what it shows,
the notation, the slug, the title and the titleblock description, then hands Claude Code the one
request that names every `twf-diagram` argument.

```
Draw a sequence diagram (Mermaid) of POST /api/perguntar in /home/you/src/pessoabot, slug
turno-sequencia, titled "One turn in time", type "Sequence diagram — Mermaid" — use
/home/you/src/twowayflow/scripts/twf-diagram to branch and land it, and open the PR, with the
title as the commit subject.
```

| Setting | What it does |
|---|---|
| `twowayflow.diagramRequest.handoff` | `terminal` (the default) runs `claude '<request>'` in a terminal opened in the project being diagrammed; `clipboard` copies the request and opens the Claude Code side bar, for a session you already have. The clipboard is also the fallback when `claude` is not on `PATH`, because a terminal would only answer "command not found". |
| `twowayflow.diagramRequest.scriptPath` | Where this checkout's `twf-diagram` is. Empty means: look for `scripts/twf-diagram` in the open workspace folders. The request has to name it absolutely, because the terminal starts in the *other* project. |

It stops at the words, deliberately. It does not run `twf-diagram start` itself: one owner for the
whole ritual means a dirty tree or an exit code `2` is something you talk about, not a
notification toast. The judgement is still yours — the notation list is a starting point, and
**Other…** takes any Type row.
