# The `*.flow.ts` eDSL

**Status:** v1 spike surface syntax. Designed before the parser/patcher, because the DSL is
simultaneously (a) the file format, (b) the public API users write by hand, and (c) the text the
canvas has to patch. Those three jobs pull in different directions; this document records the
shape chosen and *why it patches cleanly*.

Recall the architectural constraint from [tech-stack-assessment.md](tech-stack-assessment.md):

> Code on disk is the only source of truth, and the canvas is an editable projection over its
> syntax tree.

So there is no `.twf` file. A `*.flow.ts` file **is** the design. Every canvas gesture must become
a small, local, unambiguous **byte-range text edit** against that file. A DSL shape that cannot be
edited that way is disqualified, no matter how pretty it reads.

---

## 1. The surface syntax

```ts
import { flow } from "@twowayflow/dsl";

export default flow("orders-etl")
  .node("readCsv", { kind: "source", at: [0, 0], params: { path: "./orders.csv" } })
  .node("parse", { kind: "transform", at: [240, 0] })
  .node("writeDb", { kind: "sink", at: [480, 0] })
  .edge("readCsv", "parse")
  .edge("parse", "writeDb");
```

A flow is **one chained-builder expression**. Three rules, and that is the whole language:

| Form | Meaning |
|---|---|
| `flow(name)` | starts a flow, `name` is a plain string literal |
| `.node(id, options?)` | declares a computation step; `id` is a plain string literal, unique in the flow |
| `.edge(from, to, options?)` | declares data flowing from one declared node to another |

By convention — and enforced by the type system, see §4 — all `.node(...)` links come before all
`.edge(...)` links.

### Option keys the canvas understands

Everything in the options object is optional, and **anything the canvas does not recognise is
carried through untouched**.

| Key | On | Type | Used for |
|---|---|---|---|
| `kind` | node | `"source" \| "transform" \| "filter" \| "fanout" \| "join" \| "sink"` | node shape/colour, handle layout |
| `at` | node | `[x, y]` | canvas position |
| `label` | node, edge | `string` | display text (falls back to the id) |
| `description` | node | `string` | prose shown when the pointer rests on the node |
| `id` | edge | `string` | this edge's identity, when it needs one of its own (below) |

`description` is the one key the canvas reads but never writes: no gesture creates or edits one,
so the prose in the file is the only prose there is, and every patch leaves it where it was.

Any other property — `params`, `run`, `schema`, `retries`, an inline arrow function, whatever the
runtime grows later — is **opaque to the canvas**. The parser records its byte range only so the
patcher knows to stay out of it. Dragging a node must not reformat the `run:` closure sitting
beside `at:`; that is one of the properties the test suite asserts (§5 of the findings doc).

### Edge identity

A node's identity is the string it declares. An edge's identity is usually *derived*: the edge
`.edge("readCsv", "parse")` is known as `readCsv->parse`, and if the same pair is declared more
than once the later ones pick up `#1`, `#2` and so on. For the overwhelmingly common case — one
edge between a given pair — that is all anyone needs, and writing an id for it would be noise in
every file.

Parallel edges are the case where derived identity is not good enough, because it is defined by
*position among siblings*: delete the first of three `fanIn->merge` edges and the other two
shuffle down, so an id read a moment earlier now names a different edge. So an edge may declare
its own:

```ts
export default flow("routing")
  .node("fanIn", { kind: "fanout", at: [0, 0] })
  .node("merge", { kind: "join", at: [240, 0] })
  .edge("fanIn", "merge", { label: "default route" })
  .edge("fanIn", "merge", { id: "fast-path", label: "cached" })
  .edge("fanIn", "merge", { id: "slow-path", label: "recomputed" });
```

Two rules, and together they are what make this safe:

- A declared `id` **is** that edge's identity, full stop. It survives its siblings being deleted,
  and it survives both its endpoints being renamed.
- The positional fallback counts only the **undeclared** edges of a pair. Adding an `id` to one
  parallel edge therefore does not renumber the others — the edge above keeps `fanIn->merge`, not
  `fanIn->merge#2`.

The consequence is that an edge's identity depends on another edge still existing in exactly one
situation: a pair with **two or more undeclared** edges. The canvas never writes that — when it
creates an edge between a pair that already has one, it declares an id (`suggestEdgeId`) — so it
only arises in a hand-written file, and the fix is to name the edges.

Declaring an id twice in one file is an error: the parser reports `duplicate-edge-id` and the
patcher refuses to act on the ambiguous id rather than guessing which edge was meant.

### Positions live in the file, on purpose

`at: [x, y]` is layout data stored in source code, which deserves a word of defence. The
alternative is a sidecar layout file — and a sidecar layout file is the first step back towards the
`.twf` model that the whole architecture exists to avoid. It would drift from the code, conflict in
git separately from the code, and need its own identity-matching story. Keeping `at` inline means a
node and its position move, merge, rename, revert, and `git blame` as one thing. The cost is noise
in diffs when someone tidies the canvas, which is a real cost and an acceptable one.

`at` is optional. A node without it gets auto-laid-out, and the patcher inserts an `at` the first
time the node is dragged.

---

## 2. Why this shape patches cleanly

This is the part that decides whether the architecture works, so each canvas gesture is written out
as the text edit it becomes.

### Insert a node — pure insertion, zero bytes deleted

The insertion point is the end of the **last `.node(...)` link** (or the end of `flow(...)` if there
are none). Nothing is deleted, nothing is re-indented, no sibling is touched:

```diff
   .node("parse", { kind: "transform", at: [240, 0] })
+  .node("dedupe", { kind: "filter", at: [360, 0] })
   .edge("readCsv", "parse")
```

A single `{ range: [off, off], newText: "\n  .node(\"dedupe\", { kind: \"filter\", at: [360, 0] })" }`.
The indentation is read off the previous link, not imposed.

### Add an edge — also pure insertion

Insertion point is the end of the last `.edge(...)` link, else the last `.node(...)` link:

```diff
   .edge("readCsv", "parse")
+  .edge("parse", "writeDb")
```

If the new edge is the second or later one between the same pair, the canvas writes an `id` into
it, because that is the point at which derived identity stops being stable:

```diff
   .edge("readCsv", "parse")
+  .edge("readCsv", "parse", { id: "readCsv->parse#1" })
```

The id it picks is the string the positional scheme would have produced anyway, so nothing the
user sees changes shape; the identity simply becomes something written down rather than counted.

Edges are *declared*, never *inferred from nesting*. That is the single most important choice in
this document — see §3.

### Rename a node — N tiny string-literal replacements

The new name goes inside the existing quotes, and so does every reference to it. Each edit is a
replacement of the span *between* the quotes, so quoting style, spacing, and everything else in the
link survives:

```diff
-  .node("parse", { kind: "transform", at: [240, 0] })
+  .node("parseRows", { kind: "transform", at: [240, 0] })
-  .edge("readCsv", "parse")
+  .edge("readCsv", "parseRows")
```

Three spans, three edits, each a handful of bytes. No link is reprinted.

### Move a node — one array-literal replacement

```diff
-  .node("parse", { kind: "transform", at: [240, 0], run: (r) => r.map(Number) })
+  .node("parse", { kind: "transform", at: [240, 96], run: (r) => r.map(Number) })
```

The edit range is exactly the `[240, 0]` array literal. If the node has no `at` yet, the patcher
inserts ` at: [x, y],` immediately after the options object's `{` — the one position in an object
literal where insertion is unambiguous, because it never has to reason about whether a trailing
comma is already present. If there is no options object at all, one is appended as a second
argument.

### Delete a node — one contiguous deletion, plus its edges

A link's deletion range runs from the end of the **whitespace-only** run before its `.` to the end
of the link. Whitespace-only is deliberate: if a comment sits between two links, the comment is
*not* inside the deletion range, so deleting a node cannot silently eat a comment.

```ts
  .node("readCsv", { kind: "source" })
  // the parser is the slow part, see PERF-412
  .node("parse", { kind: "transform" })
```

Deleting `parse` leaves the comment where it was. (If the deletion would leave the rest of the
chain stranded on a `//` comment line, the patcher substitutes a newline plus indentation instead
of an empty string, so the result still compiles.)

---

## 3. What was rejected, and why

### Nested object literal

```ts
export default flow({
  name: "orders-etl",
  nodes: { readCsv: { kind: "source" }, parse: { kind: "transform" } },
  edges: [["readCsv", "parse"]],
});
```

Reads nicely; patches badly. Inserting a node means editing *inside* a nested object, where the
insertion point depends on whether the object is empty, whether a trailing comma is already there,
and how the author broke the lines. Those are three independent sources of "produce either a syntax
error or a diff that touches the previous line". The chained form turns every one of those cases
into "append after a `)`", which has exactly one answer.

### Edges inferred from nesting

```ts
export default sink(transform(source("./orders.csv")));
```

This is the trap. It is the most elegant on the page and the least patchable form possible. Adding
one edge is a *tree rotation*: a subtree has to be lifted out and re-nested somewhere else, which is
a large non-local text edit — precisely the "regenerate the file" move the architecture forbids. It
also cannot express a DAG without naming intermediates, so the moment a node has two consumers the
syntax has to grow a second, different way of saying "edge" anyway.

### Decorators / classes

Needs `experimentalDecorators`, ties the file format to a TypeScript config flag, and puts the
graph topology in the *type* position where it is far harder to patch than an argument list.

### The property that makes the chain win

Every element of the graph is **one chain link, on its own line, textually independent of its
siblings**. Topology is flat and explicit instead of structural. That means:

- insert = append after a `)`
- delete = remove one contiguous run
- rename = overwrite the inside of a string literal
- move = overwrite one array literal

All four are O(bytes-changed), none of them reads or rewrites a sibling, and none of them has to
understand a construct it did not author. Opaque user code — closures, imported helpers, generics —
sits inside an options object where the patcher's only job is to not go near it.

---

## 4. Types

`flow()` returns a builder that accumulates declared node ids into a string-literal union, so
`.edge()` only accepts ids that have already been declared:

```ts
flow("f")
  .node("a", { kind: "source" })
  .edge("a", "b");
//            ~~~ Argument of type '"b"' is not assignable to parameter of type '"a"'
```

This is why nodes precede edges: it is not a style rule, it is what makes a dangling edge a
compile error instead of a runtime one. The parser still accepts dangling edges — it has to, since
it must read half-finished files — and reports them as diagnostics.

The exported value is the builder itself; there is no terminal `.build()` call. That keeps the end
of the chain a safe append position forever, which is what makes "insert a node" an insertion
rather than a replacement. `toSpec()` materialises a plain `FlowSpec` for a runtime to execute.

---

## 5. What the parser refuses to understand

The parser is error-tolerant by construction (tree-sitter), and the canvas has to cope with
half-written files. A chain link is **unparsable** — recorded with its span, rendered as an opaque
box, and never patched — when:

- the id is not a plain double-quoted string literal (a variable, a template literal, a
  concatenation, or a string containing an escape sequence) — including an edge's `id` option,
  which is identity and so is refused rather than ignored the way an unreadable `kind` or `label`
  is;
- the method is not `node` or `edge`;
- the link uses optional chaining (`?.node(...)`);
- the arguments do not type-shape as expected.

This is a feature, not a limitation. A file with one link the tool does not understand must still
open, still show the other six nodes, and still be safely draggable. `packages/core/test/fixtures/`
contains such a file, and the test suite asserts that its unparsable links come out of a patch
byte-for-byte unchanged.
