# twowayflow

An editable dataflow canvas over `*.flow.ts` files, inside VS Code.

**The code on disk is the only source of truth.** The canvas is a projection over the file's
syntax tree, and every canvas gesture becomes a surgical byte-range edit to the source — never a
regeneration. Drag a node and exactly one array literal changes; your comments, formatting and
inline code are untouched.

## Use it

Open a `*.flow.ts` file and run **twowayflow: Open Flow Canvas** from the editor title bar or the
command palette.

- **Drag a node** — writes `at: [x, y]` back to the source.
- **Double-click the canvas** — adds a node.
- **Double-click a node** — renames it, updating every edge that references it.
- **Drag between handles** — adds an edge.
- **Select a node** — reveals its source range; moving the text cursor highlights the node.

There is no Sync button. The canvas follows the file continuously, in both directions.

## The file format

```ts
import { flow } from "@twowayflow/dsl";

export default flow("orders-etl")
  .node("readCsv", { kind: "source", at: [0, 120] })
  .node("parseRows", { kind: "transform", at: [260, 120] })
  .edge("readCsv", "parseRows", { label: "lines" });
```

Anything in the options object that the canvas does not recognise — `params`, `run`, your own
keys — is opaque payload and is never touched by an edit.

A link the parser cannot read (a non-literal id, an unknown method) is shown as an opaque box and
left alone, so a half-written file still opens.

## Status

v1 spike. See `docs/spike-findings.md` in the repository for an honest account of what has been
verified and what has not.
