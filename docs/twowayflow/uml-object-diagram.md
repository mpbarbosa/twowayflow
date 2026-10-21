# twowayflow — UML object diagrams

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Name         uml-object-diagram                                                             │
│ Type         UML object diagram — instance snapshots with real runtime values               │
│ Project      twowayflow                                                                     │
│ Description  The object graph in memory after parsing examples/orders-etl.flow.ts, the      │
│              same graph two projections later inside the React webview, and one canvas      │
│              drag turning into one ranged text edit across both runtimes. Every attribute   │
│              value below was produced by running the real parser, patcher and canvas        │
│              projection, not written by hand.                                                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

> **Class diagram vs. object diagram.** A class diagram shows the *types* and holds for every
> run; that is [uml-class-diagram.md](uml-class-diagram.md). An object diagram shows *one
> snapshot of actual instances* with their actual attribute values. All five below are real: the
> values came out of `parseFlowSource()`, `patch()`, `suggestEdgeId()` and `toCanvasGraph()` on
> [examples/orders-etl.flow.ts](../../examples/orders-etl.flow.ts) (1975 characters), so they are
> reproducible rather than illustrative.
>
> §1–§3 are the extension host; §4 is the same data inside the webview; §5 is the drag crossing
> between them.

## 1. After parsing `orders-etl.flow.ts`

```mermaid
classDiagram
    direction TB

    class file["file : FlowFile"] {
        source = the 1975-char file text
        name = orders-etl
        nameSpan = 1198 to 1208
        chainSpan = 1192 to 1973
        rootCallSpan = 1192 to 1210
        nodes = 4 items
        edges = 3 items
        unknownLinks = empty
        diagnostics = empty
    }

    class n0["readCsv : FlowNode"] {
        id = readCsv
        idSpan = 1220 to 1227
        kind = source
        label = undefined
        position = x 0 y 120
        positionSpan = 1260 to 1268
        optionsSpan = 1230 to 1334
    }
    class n1["parseRows : FlowNode"] {
        id = parseRows
        idSpan = 1345 to 1354
        kind = transform
        label = undefined
        position = x 274 y 214
        positionSpan = 1390 to 1400
        optionsSpan = 1357 to 1618
    }
    class n2["dropIncomplete : FlowNode"] {
        id = dropIncomplete
        idSpan = 1629 to 1643
        kind = filter
        label = drop incomplete
        position = x 520 y 120
        positionSpan = 1668 to 1678
        optionsSpan = 1646 to 1706
    }
    class n3["writeDb : FlowNode"] {
        id = writeDb
        idSpan = 1717 to 1724
        kind = sink
        label = undefined
        position = x 780 y 120
        positionSpan = 1755 to 1765
        optionsSpan = 1727 to 1825
    }

    class e0["e0 : FlowEdge"] {
        id = readCsv->parseRows
        declaredId = undefined
        idSpan = undefined
        from = readCsv
        fromSpan = 1836 to 1843
        to = parseRows
        toSpan = 1847 to 1856
        label = lines
        optionsSpan = 1859 to 1877
    }
    class e1["e1 : FlowEdge"] {
        id = parseRows->dropIncomplete
        declaredId = undefined
        from = parseRows
        fromSpan = 1888 to 1897
        to = dropIncomplete
        toSpan = 1901 to 1915
        label = rows
        optionsSpan = 1918 to 1935
    }
    class e2["e2 : FlowEdge"] {
        id = dropIncomplete->writeDb
        declaredId = undefined
        from = dropIncomplete
        fromSpan = 1946 to 1960
        to = writeDb
        toSpan = 1964 to 1971
        label = undefined
        optionsSpan = undefined
    }

    class l0["l0 : ChainLink"] {
        method = node
        span = 1213 to 1335
        leadingTriviaStart = 1210
        index = 0
    }
    class l1["l1 : ChainLink"] {
        method = node
        span = 1338 to 1619
        leadingTriviaStart = 1335
        index = 1
    }
    class l2["l2 : ChainLink"] {
        method = node
        span = 1622 to 1707
        leadingTriviaStart = 1619
        index = 2
    }
    class l3["l3 : ChainLink"] {
        method = node
        span = 1710 to 1826
        leadingTriviaStart = 1707
        index = 3
    }
    class l4["l4 : ChainLink"] {
        method = edge
        span = 1829 to 1878
        leadingTriviaStart = 1826
        index = 4
    }
    class l5["l5 : ChainLink"] {
        method = edge
        span = 1881 to 1936
        leadingTriviaStart = 1878
        index = 5
    }
    class l6["l6 : ChainLink"] {
        method = edge
        span = 1939 to 1973
        leadingTriviaStart = 1936
        index = 6
    }

    file --> n0 : nodes[0]
    file --> n1 : nodes[1]
    file --> n2 : nodes[2]
    file --> n3 : nodes[3]
    file --> e0 : edges[0]
    file --> e1 : edges[1]
    file --> e2 : edges[2]

    n0 --> l0 : link
    n1 --> l1 : link
    n2 --> l2 : link
    n3 --> l3 : link
    e0 --> l4 : link
    e1 --> l5 : link
    e2 --> l6 : link

    e0 ..> n0 : from resolves to
    e0 ..> n1 : to resolves to
    e1 ..> n1 : from resolves to
    e1 ..> n2 : to resolves to
    e2 ..> n2 : from resolves to
    e2 ..> n3 : to resolves to
```

### What this snapshot shows that the class diagram cannot

- **The links tile the chain.** Each `ChainLink.leadingTriviaStart` equals the previous link's
  `span.end` — 1210/1335, 1335/1619, 1619/1707, 1707/1826, 1826/1878, 1878/1936, 1936/1973 —
  and the last `span.end` is `chainSpan.end`. That contiguity is the invariant
  `checkSpanInvariants()` exists to assert, and it is what makes deletion able to take its own
  newline and indentation with it and nothing else.
- **`parseRows.optionsSpan` is 261 characters** (1357→1618) for a node whose canvas-visible
  attributes are two words and a coordinate pair. The rest is the inline `run:` arrow function —
  opaque payload. A drag must leave all 261 bytes alone except the 10 inside `positionSpan`.
- **Edge identity is positional in all three cases.** `declaredId` is `undefined` throughout, so
  every `id` is the derived `from->to`. No pair repeats here, so no `#n` suffix appears and every
  identity is stable. `e2` additionally has no `label` and no `optionsSpan`, because
  `.edge("dropIncomplete", "writeDb")` was written without an options object at all.
- **Both failure lists are empty.** `unknownLinks` and `diagnostics` being empty is what makes
  this file fully projectable; a fixture like `unparsable-beside-valid.flow.ts` would populate the
  first, and the canvas would draw those links as opaque boxes.

## 2. One canvas drag: `moveNode` → a single `TextEdit`

The user drags `parseRows` from (274, 214) to (300, 220). This is the object graph that carries
that gesture from webview to disk — the real output of `patch()`.

```mermaid
classDiagram
    direction LR

    class msg["msg : WebviewToExtension"] {
        type = moveNode
        nodeId = parseRows
        position = x 300 y 220
    }
    class panel["panel : FlowPanel"] {
        revision = 1 before, 2 after
        applyingOwnEdit = true only during applyEdit
        file = the FlowFile above
    }
    class op["op : FlowOp"] {
        op = moveNode
        id = parseRows
        position = x 300 y 220
    }
    class result["result : PatchResult"] {
        edits = 1 item
        warnings = empty
    }
    class edit["edit : TextEdit"] {
        range = 1390 to 1400
        newText = [300, 220]
        reason = move node parseRows
    }
    class target["target : FlowNode"] {
        id = parseRows
        positionSpan = 1390 to 1400
        old text at that range = [274, 214]
        optionsSpan = 1357 to 1618 untouched
    }
    class wsedit["wsedit : vscode.WorkspaceEdit"] {
        one replace, line 26 chars 8 to 18
        zero-based, via document.positionAt
        the at: [274, 214] line
    }

    msg --> panel : onMessage()
    panel ..> op : builds
    panel ..> result : patch(file, [op])
    result --> edit : edits[0]
    edit ..> target : range equals positionSpan
    panel ..> wsedit : applyOps() converts
    wsedit ..> panel : change event, schedules re-parse
```

**The whole drag is a 10-character replacement.** `range` is exactly
`parseRows.positionSpan` from the snapshot above, `[274, 214]` becomes `[300, 220]`, `warnings`
is empty, and the 261-byte `optionsSpan` containing the `run:` closure is never in any edit's
range. Nothing is reprinted, so VS Code sees an ordinary text edit and undo, git gutters and
dirty state all behave as they do for typing.

**The re-parse after the extension's own edit is deliberate, not suppressed.** `applyOps()`
calls `scheduleReparse()` explicitly on its last line, and `onDidChangeTextDocument` schedules one
too; the debounce collapses them into a single parse 60 ms later, which bumps `revision` to 2 and
posts a fresh graph. That is the whole design: the canvas never updates from its own gesture, it
updates from the file — so what the user sees after a drag has been through the parser.

`applyingOwnEdit` guards something narrower, in the *other* sync direction. Applying a
`WorkspaceEdit` moves the editor's selection, which fires `onDidChangeTextEditorSelection`;
without the flag, `revealFromCursor()` would read that as the user moving the cursor and post a
`reveal` back to the canvas. It is a selection-echo guard
([panel.ts:278](../../packages/vscode-ext/src/panel.ts#L278)), the only place it is read.

## 3. Edge identity under `suggestEdgeId` — two instance cases

`FlowPanel.onMessage` asks `suggestEdgeId()` whether a new edge needs a declared id. Both results
below are real calls against the parse in §1:

```mermaid
classDiagram
    direction TB

    class callA["callA : suggestEdgeId"] {
        edges = the 3 parsed edges
        from = readCsv
        to = writeDb
        returns = undefined
    }
    class opA["opA : FlowOp"] {
        op = addEdge
        from = readCsv
        to = writeDb
        id = omitted
    }
    class callB["callB : suggestEdgeId"] {
        edges = the 3 parsed edges
        from = readCsv
        to = parseRows
        returns = readCsv->parseRows#1
    }
    class opB["opB : FlowOp"] {
        op = addEdge
        from = readCsv
        to = parseRows
        id = readCsv->parseRows#1
    }
    class e0ref["e0 : FlowEdge"] {
        id = readCsv->parseRows
        declaredId = undefined
    }

    callA ..> opA : no id needed
    callB ..> opB : id declared
    callB ..> e0ref : pair already taken by
```

The first pair has no existing edge, so `from->to` already identifies it and no `id` is written —
keeping the authored file as clean as a hand-written one. The second pair is already occupied by
`e0`, so the canvas declares `readCsv->parseRows#1` on the new edge. That declaration is what
makes `e0`'s own positional identity safe: deleting the new edge cannot renumber it, because
`edgeIds()` counts only *undeclared* edges.

## 4. The webview, at the instant before the drag

The same four nodes again, two projections further on: `FlowFile` → `toCanvasGraph()` →
`CanvasGraph` → `toReactFlow()` → xyflow `Node` objects. Both projections were executed, so
every value below is output, not transcription (see [Reproducing](#reproducing-these-values)).

```mermaid
classDiagram
    direction TB

    class inner["inner : CanvasInner"] {
        graph = the CanvasGraph below
        cursorNodeId = undefined
        error = undefined
        no nodes state
        no edges state
    }
    class cg["cg : CanvasGraph"] {
        name = orders-etl
        revision = 1
        nodes = 4 items
        edges = 3 items
        unknown = empty
        diagnostics = empty
    }
    class cn1["cn1 : CanvasNode"] {
        id = parseRows
        kind = transform
        label = undefined
        description = undefined
        position = x 274 y 214
        span = 1338 to 1619
        hasExplicitPosition = true
    }
    class cn2["cn2 : CanvasNode"] {
        id = dropIncomplete
        kind = filter
        label = drop incomplete
        position = x 520 y 120
        span = 1622 to 1707
        hasExplicitPosition = true
    }
    class rf1["rf1 : xyflow Node"] {
        id = parseRows
        type = flowNode
        position = x 274 y 214
        data = d1
    }
    class d1["d1 : FlowNodeData"] {
        label = parseRows
        kind = transform
        nodeId = parseRows
        description = absent
        inSync = false
    }
    class rf2["rf2 : xyflow Node"] {
        id = dropIncomplete
        type = flowNode
        position = x 520 y 120
        data = d2
    }
    class d2["d2 : FlowNodeData"] {
        label = drop incomplete
        kind = filter
        nodeId = dropIncomplete
        inSync = false
    }
    class rfe["rfe0 : xyflow Edge"] {
        id = readCsv->parseRows
        source = readCsv
        target = parseRows
        label = lines
        markerEnd = ArrowClosed
    }
    class view["view : FlowNodeView"] {
        props.data = d1
        props.selected = false
        renders glyph f for transform
        two Handles, Left and Right
    }
    class d1b["d1 : FlowNodeData (cursor in the link)"] {
        label = parseRows
        kind = transform
        nodeId = parseRows
        inSync = true
    }

    inner --> cg : useState graph
    cg --> cn1 : nodes[1]
    cg --> cn2 : nodes[2]
    inner ..> rf1 : useMemo toReactFlow
    inner ..> rf2 : useMemo toReactFlow
    inner ..> rfe : useMemo toReactFlow
    cn1 ..> rf1 : projected to
    cn2 ..> rf2 : projected to
    rf1 --> d1 : data
    rf2 --> d2 : data
    rf1 ..> view : rendered by NODE_TYPES flowNode
    view --> d1 : reads
    d1 ..> d1b : same node once cursorNodeId = parseRows
```

Three things this snapshot pins down:

- **`CanvasNode.span` is the whole `.node(...)` link, not the id.** `parseRows` carries
  1338→1619 here, where the `FlowNode` in §1 carried `idSpan` 1345→1354 and `positionSpan`
  1390→1400 separately. `toCanvasGraph` keeps only `node.link.span`, because the only thing the
  canvas does with a span is reveal the link in the editor. The fine-grained spans stay on the
  extension side, where patching happens.
- **Identity and label part company.** `d2.label` is `drop incomplete` while `rf2.id` is
  `dropIncomplete`. `toReactFlow` computes `node.label ?? node.id`, so a node with no `label`
  option displays its id — `d1.label` is `parseRows` for exactly that reason. Gestures carry
  `node.id`, never the displayed text.
- **`inner` has no node state at all.** `rf1`, `rf2` and `rfe` are not stored anywhere; they are
  the current value of a `useMemo` and are rebuilt whenever `graph` or `cursorNodeId` changes.
  There is no object in this diagram that could hold a position the file disagrees with. Running
  `toReactFlow` a second time with `cursorNodeId = "parseRows"` returns a wholly new array whose
  only difference is `inSync: true` on that one node (`d1` above becomes `d1b`) — the
  cursor-follows-canvas highlight is a re-projection, not a mutation.

With `hasExplicitPosition: true` on all four nodes, nothing here is auto-laid-out. Had a node
been written without `at:`, `toCanvasGraph` would have invented a position from `COLUMN_WIDTH`
and `ROW_HEIGHT` and flagged it `false` — a position the canvas shows but the file does not
contain, and which a drag then writes for the first time.

## 5. The full round trip, both runtimes

The drag from §2, as it actually crosses the process boundary. Real values throughout.

```mermaid
sequenceDiagram
    autonumber
    actor user as User
    participant rf as ReactFlow<br/>(webview)
    participant inner as CanvasInner<br/>(webview)
    participant vs as vscode.ts<br/>(webview)
    participant panel as FlowPanel<br/>(extension host)
    participant core as core<br/>patch + parse
    participant doc as TextDocument<br/>orders-etl.flow.ts

    user->>rf: drag parseRows, release at 300 220
    rf->>inner: onNodeDragStop(node)
    Note over inner: onNodesChange ignores the move.<br/>No local state is written.
    inner->>vs: send moveNode parseRows 300 220
    vs->>panel: postMessage across the boundary
    panel->>panel: onMessage, builds one FlowOp
    panel->>core: patch(file, [moveNode])
    core-->>panel: PatchResult, 1 edit, 0 warnings<br/>range 1390 to 1400, newText [300, 220]
    panel->>panel: guard, document text still equals file.source
    panel->>doc: WorkspaceEdit.replace, 10 chars
    Note over panel,doc: applyingOwnEdit = true,<br/>so the selection move does not echo back
    doc-->>panel: onDidChangeTextDocument
    panel->>panel: scheduleReparse, 60 ms debounce
    panel->>core: parseFlowSourceWith(document text)
    core-->>panel: FlowFile, parseRows at 300 220
    panel->>panel: revision 1 becomes 2
    panel->>vs: post graph, CanvasGraph revision 2
    vs->>inner: onMessage handler, setGraph
    inner->>rf: useMemo re-runs toReactFlow
    rf->>user: parseRows now drawn at 300 220
```

The node the user let go of at (300, 220) is drawn at (300, 220) only at the last step — after a
patch, a disk-level text edit, and a fresh parse. Between the release and that frame it is drawn
wherever the *previous* parse said, which is why `onNodesChange` discarding the move is not a bug
to be fixed later: it is the mechanism. A canvas that optimistically moved the node would be
holding a second model, and the first time a patch failed or a hand edit disagreed, the two would
drift — which is the exact failure the project exists to avoid.

Two guards on that path are worth naming, because both are places the loop could corrupt rather
than merely misdraw:

- **Re-parse before patching.** If a debounced parse is still pending when a gesture arrives,
  `applyOps()` parses first. Patching against stale offsets would not give a wrong answer, it
  would write bytes into the wrong place.
- **Text equality check.** `applyOps()` compares `document.getText()` to `file.source` and bails
  to a plain re-parse if they differ. The spans in a `TextEdit` are only meaningful against the
  text they were computed from.

## Reproducing these values

Both snapshots came from running the shipped code against the example:

```bash
pnpm install && pnpm test
```

The parse in §1 is `parseFlowSource(readFileSync("examples/orders-etl.flow.ts", "utf8"))`; the
patch in §2 is `patch(file, [{ op: "moveNode", id: "parseRows", position: { x: 300, y: 220 } }])`;
the two calls in §3 are `suggestEdgeId(file.edges, from, to)`; the canvas graph in §4 is
`toCanvasGraph(file, 1)`.

`toReactFlow` is module-private in `Canvas.tsx`, so it was executed without altering the file:
its source ([Canvas.tsx:22-59](../../packages/vscode-ext/webview/Canvas.tsx#L22-L59)) was sliced
out between the `function toReactFlow(` and `function CanvasInner(` markers, stripped of types
with the repo's own esbuild
(`esbuild --loader=ts --format=cjs`), and called with a `MarkerType` stub — the only runtime
value it closes over. Spans are UTF-16 code-unit indices
into `file.source`, so `sliceSpan(file.source, span)` reads back the text any box above refers to.
Editing the example file shifts every offset, which is the point: the numbers are a snapshot of
one file at one revision, not part of the model.
