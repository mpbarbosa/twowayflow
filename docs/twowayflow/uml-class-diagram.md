# twowayflow — UML class diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Name         uml-class-diagram                                                              │
│ Type         UML class diagram — static structure, extracted from source                    │
│ Project      twowayflow                                                                     │
│ Description  The declared types of all three packages and the relationships between them:   │
│              the DSL builder that defines the file format, the span-carrying parse model in │
│              core, the extension class that holds one canvas per document, and the React    │
│              webview that draws it. Extracted from packages/*/src and                        │
│              packages/vscode-ext/webview at commit 0742448.                                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Read this first: what "class" means in this codebase

This is a deliberately class-light TypeScript codebase. A faithful extraction finds **five
classes**, four of which are `Error` subclasses:

| Class | File | Role |
|---|---|---|
| `FlowPanel` | [panel.ts:42](../../packages/vscode-ext/src/panel.ts#L42) | the only real stateful object: one per open document |
| `PatchError` | [patch.ts:46](../../packages/core/src/patch.ts#L46) | patch refused |
| `UnprintableIdentifierError` | [print.ts:25](../../packages/core/src/print.ts#L25) | id/label cannot round-trip |
| `OverlappingEditsError` | [text.ts:3](../../packages/core/src/text.ts#L3) | two edits claim the same range |
| `SpanTilingError` | [spans.ts:13](../../packages/core/src/spans.ts#L13) | span invariant violated |

Everything else is a `readonly` **interface**, a **discriminated union**, or a free **function** —
including the webview, whose four React components are function components, not classes.
So the diagrams below use UML stereotypes — `«interface»`, `«union»`, `«module»` — rather than
pretending the types are classes. That is not a limitation of the extraction; it is the design,
and it follows from the one architectural rule: there is no persisted design model to own
behaviour, only immutable projections over text.

## 1. `@twowayflow/dsl` — the file format

```mermaid
classDiagram
    direction LR

    class FlowBuilder~Ids~ {
        <<interface>>
        +name: string
        +node(id, options) FlowBuilder~Ids or Id~
        +edge(from, to, options) FlowBuilder~Ids~
        +toSpec() FlowSpec
    }
    class flow {
        <<module function>>
        +flow(name) FlowBuilder~never~
    }
    class NodeOptions {
        <<interface>>
        +kind: NodeKind
        +at: readonly number number
        +label: string
        +description: string
        +[key: string]: unknown
    }
    class EdgeOptions {
        <<interface>>
        +id: string
        +label: string
        +[key: string]: unknown
    }
    class FlowSpec {
        <<interface>>
        +name: string
        +nodes: readonly NodeSpec[]
        +edges: readonly EdgeSpec[]
    }
    class NodeSpec {
        <<interface>>
        +id: string
        +kind: NodeKind
        +label: string
        +position: Position
        +options: Record~string, unknown~
    }
    class EdgeSpec {
        <<interface>>
        +from: string
        +to: string
        +id: string
        +label: string
    }
    class Position {
        <<interface>>
        +x: number
        +y: number
    }
    class NodeKind {
        <<union>>
        source
        transform
        filter
        fanout
        join
        sink
    }

    flow ..> FlowBuilder : creates
    FlowBuilder ..> NodeOptions : parameter
    FlowBuilder ..> EdgeOptions : parameter
    FlowBuilder ..> FlowSpec : materialises
    FlowBuilder --> FlowBuilder : returns a new one
    FlowSpec *-- NodeSpec
    FlowSpec *-- EdgeSpec
    NodeSpec --> Position
    NodeSpec --> NodeKind
    NodeOptions --> NodeKind
```

Two relationships carry the design:

- **`FlowBuilder --> FlowBuilder`** is a self-association, not inheritance. Every `.node()` and
  `.edge()` returns a *new* builder, so a `.flow.ts` file is one expression with no mutation.
- The **`Ids` type parameter** accumulates declared node ids as a string-literal union, so
  `.edge()` can only name a node that already exists. A dangling edge is a compile error, not a
  runtime check. Nothing in the diagram enforces this — the type system does.

## 2. `@twowayflow/core` — the parse model

Every type here carries a `Span`. That is the whole point: the canvas is a projection, so each
projected thing must know the byte range it came from.

```mermaid
classDiagram
    direction TB

    class FlowFile {
        <<interface>>
        +source: string
        +name: string
        +nameSpan: Span
        +chainSpan: Span
        +rootCallSpan: Span
        +nodes: readonly FlowNode[]
        +edges: readonly FlowEdge[]
        +unknownLinks: readonly UnknownLink[]
        +diagnostics: readonly Diagnostic[]
    }
    class Span {
        <<interface>>
        +start: number
        +end: number
    }
    class ChainLink {
        <<interface>>
        +method: string
        +span: Span
        +leadingTriviaStart: number
        +index: number
    }
    class FlowNode {
        <<interface>>
        +id: string
        +idSpan: Span
        +kind: NodeKind
        +label: string
        +description: string
        +position: Position
        +positionSpan: Span
        +optionsSpan: Span
        +link: ChainLink
    }
    class FlowEdge {
        <<interface>>
        +id: string
        +declaredId: string
        +idSpan: Span
        +from: string
        +fromSpan: Span
        +to: string
        +toSpan: Span
        +label: string
        +optionsSpan: Span
        +link: ChainLink
    }
    class UnknownLink {
        <<interface>>
        +link: ChainLink
        +reason: UnparsableReason
    }
    class Diagnostic {
        <<interface>>
        +code: DiagnosticCode
        +severity: error or warning
        +message: string
        +span: Span
    }
    class TextEdit {
        <<interface>>
        +range: Span
        +newText: string
        +reason: string
    }
    class FlowGraphSpec {
        <<interface>>
        +name: string
        +nodes: span-free node data
        +edges: span-free edge data
    }
    class UnparsableReason {
        <<union>>
        unknown-method
        non-literal-id
        empty-id
        optional-chain
        bad-arity
        syntax-error
    }
    class DiagnosticCode {
        <<union>>
        no-flow-chain
        unparsable-link
        duplicate-node-id
        duplicate-edge-id
        dangling-edge
        syntax-error
    }

    FlowFile *-- FlowNode
    FlowFile *-- FlowEdge
    FlowFile *-- UnknownLink
    FlowFile *-- Diagnostic
    FlowFile ..> Span : name, chain, rootCall
    FlowNode --> ChainLink
    FlowNode ..> Span : id, position, options
    FlowEdge --> ChainLink
    FlowEdge ..> Span : id, from, to, options
    UnknownLink --> ChainLink
    UnknownLink --> UnparsableReason
    ChainLink --> Span
    Diagnostic --> Span
    Diagnostic --> DiagnosticCode
    TextEdit --> Span
    FlowFile ..> FlowGraphSpec : specOf()
```

`FlowEdgeDraft` is `Omit<FlowEdge, "id">` — the edge as the parser reads it, before `edgeIds()`
resolves identity across the file. It is a type alias, so it has no box of its own.

## 3. `@twowayflow/core` — the patch API and its errors

```mermaid
classDiagram
    direction LR

    class FlowOp {
        <<union>>
        addNode id kind label position
        deleteNode id
        renameNode id newId
        moveNode id position
        addEdge from to id label
        deleteEdge edgeId
    }
    class PatchResult {
        <<interface>>
        +edits: readonly TextEdit[]
        +warnings: readonly Diagnostic[]
    }
    class patchModule {
        <<module>>
        +patch(file, ops) PatchResult
        +applyPatch(...) string
        +applyOpsToSpec(spec, ops) FlowGraphSpec
        +suggestEdgeId(edges, from, to) string
        +untouchedSpansFor(file) Span[]
    }
    class textModule {
        <<module>>
        +applyEdits(source, edits) string
        +extractComments(...)
        +indentationAt(...)
        +isInsideLineComment(...)
        +shiftOffset(...)
        +whitespaceRunStart(...)
    }
    class printModule {
        <<module>>
        +printNodeLink(fields) string
        +printEdgeLink(fields) string
        +printFlowFile(spec) string
        +printPosition(...)
        +quote(...)
        +isPlainLiteralBody(...)
    }
    class spansModule {
        <<module>>
        +allLinks(file) ChainLink[]
        +checkSpanInvariants(file) SpanViolation[]
        +reassembleFromLinks(file) string
    }
    class Error {
        <<built-in>>
    }
    class PatchError {
        +name = PatchError
    }
    class UnprintableIdentifierError {
        +value: string
        +name = UnprintableIdentifierError
    }
    class OverlappingEditsError {
        +a: TextEdit
        +b: TextEdit
        +name = OverlappingEditsError
    }
    class SpanTilingError {
        +name = SpanTilingError
    }
    class SpanViolation {
        <<interface>>
        +what: string
        +detail: string
        +span: Span
    }
    class NodeLinkFields {
        <<interface>>
        +id, kind, label, description, position
    }
    class EdgeLinkFields {
        <<interface>>
        +from, to, id, label
    }

    Error <|-- PatchError
    Error <|-- UnprintableIdentifierError
    Error <|-- OverlappingEditsError
    Error <|-- SpanTilingError

    patchModule ..> FlowOp : consumes
    patchModule ..> PatchResult : produces
    patchModule ..> PatchError : throws
    textModule ..> OverlappingEditsError : throws
    printModule ..> UnprintableIdentifierError : throws
    printModule ..> NodeLinkFields
    printModule ..> EdgeLinkFields
    spansModule ..> SpanTilingError : throws
    spansModule ..> SpanViolation : reports
    OverlappingEditsError --> TextEdit
    SpanViolation --> Span
```

The four error classes are the only inheritance in the repository, and each one marks a boundary
where the architectural rule could be broken: a patch that cannot be expressed as ranged edits
(`PatchError`), an identifier that cannot survive a round-trip
(`UnprintableIdentifierError`), two edits fighting over one range (`OverlappingEditsError`), and a
parse whose spans no longer tile the source (`SpanTilingError`).

## 4. `packages/vscode-ext` — the one stateful class

```mermaid
classDiagram
    direction TB

    class FlowPanel {
        -static byDocument: Map~string, FlowPanel~
        -file: FlowFile
        -revision: number
        -reparseTimer: Timeout
        -applyingOwnEdit: boolean
        -disposables: Disposable[]
        -panel: WebviewPanel
        -document: TextDocument
        -parser: Parser
        -extensionUri: Uri
        +static open(document, extensionUri) Promise~FlowPanel~
        -constructor(panel, document, parser, extensionUri)
        -dispose() void
        -scheduleReparse() void
        -reparse() void
        -post(message) void
        -onMessage(message) Promise
        -applyOps(ops) Promise
        -freshNodeId() string
        -toRange(span) Range
        -revealInEditor(nodeId) void
        -revealFromCursor(position) void
        -html() string
    }
    class extensionModule {
        <<module>>
        +activate(context) void
        +deactivate() void
    }
    class graphModule {
        <<module>>
        +toCanvasGraph(file, revision) CanvasGraph
    }
    class CanvasGraph {
        <<interface>>
        +name: string
        +nodes: readonly CanvasNode[]
        +edges: readonly CanvasEdge[]
        +unknown: readonly CanvasUnknown[]
        +diagnostics: readonly Diagnostic[]
        +revision: number
    }
    class CanvasNode {
        <<interface>>
        +id: string
        +kind: string
        +label: string
        +description: string
        +position: x y
        +span: Span
        +hasExplicitPosition: boolean
    }
    class CanvasEdge {
        <<interface>>
        +id: string
        +from: string
        +to: string
        +label: string
        +span: Span
    }
    class CanvasUnknown {
        <<interface>>
        +id: string
        +text: string
        +reason: string
        +span: Span
    }
    class ExtensionToWebview {
        <<union>>
        graph graph
        reveal nodeId
        error message
    }
    class WebviewToExtension {
        <<union>>
        ready
        selectNode nodeId
        moveNode nodeId position
        renameNode nodeId newId
        deleteNode nodeId
        addNode position
        addEdge from to
        deleteEdge edgeId
    }

    extensionModule ..> FlowPanel : open()
    FlowPanel "1" --> "1" FlowFile : holds the current parse
    FlowPanel ..> graphModule : projects
    FlowPanel ..> ExtensionToWebview : posts
    FlowPanel ..> WebviewToExtension : receives
    FlowPanel ..> FlowOp : emits on gesture
    graphModule ..> CanvasGraph : produces
    CanvasGraph *-- CanvasNode
    CanvasGraph *-- CanvasEdge
    CanvasGraph *-- CanvasUnknown
    CanvasGraph *-- Diagnostic
    CanvasNode --> Span
    CanvasEdge --> Span
    CanvasUnknown --> Span
```

`FlowPanel.byDocument` is a private static registry keyed by document URI — a multiton, so a
second **Open Flow Canvas** on the same file reveals the existing panel instead of creating a
rival projection. `applyingOwnEdit` is the echo guard that keeps the two directions from looping.

## 5. `packages/vscode-ext/webview` — the React layer

Across the postMessage boundary the architectural rule has to hold a second time, in a library
whose whole idiom is local state. `@xyflow/react` expects to own its nodes; here it is not
allowed to.

```mermaid
classDiagram
    direction TB

    class mainModule {
        <<module main.tsx>>
        +createRoot(root).render(Canvas)
        imports xyflow style.css and canvas.css
    }
    class Canvas {
        <<react component>>
        +Canvas() ReactElement
        wraps CanvasInner in ReactFlowProvider
    }
    class CanvasInner {
        <<react component>>
        -graph: CanvasGraph
        -cursorNodeId: string
        -error: string
        -wrapper: RefObject~HTMLDivElement~
        -screenToFlowPosition: from useReactFlow
        -onNodesChange(changes) void
        -onNodeDragStop(event, node) void
        -onConnect(connection) void
        -onEdgesDelete(deleted) void
        -onNodesDelete(deleted) void
        -onNodeDoubleClick(event, node) void
        -onPaneDoubleClick(event) void
        -onAddNodeAtCentre() void
    }
    class toReactFlow {
        <<module function>>
        +toReactFlow(graph, cursorNodeId) nodes and edges
    }
    class NODE_TYPES {
        <<const map>>
        flowNode to FlowNodeView
        unknownNode to UnknownNodeView
    }
    class FlowNodeView {
        <<react component>>
        +FlowNodeView(props) ReactElement
        glyph, label, kind tag, tooltip
        Handle target Left and source Right
    }
    class UnknownNodeView {
        <<react component>>
        +UnknownNodeView(props) ReactElement
        drawn, never patched
    }
    class FlowNodeData {
        <<interface>>
        +label: string
        +kind: string
        +nodeId: string
        +description: string
        +inSync: boolean
    }
    class KIND_GLYPH {
        <<const map>>
        source transform filter
        fanout join sink unknown
    }
    class vscodeModule {
        <<module vscode.ts>>
        +vscodeApi: VsCodeApi
        +send(message) void
        +onMessage(handler) unsubscribe
    }
    class VsCodeApi {
        <<interface>>
        +postMessage(message) void
        +getState() unknown
        +setState(state) void
    }
    class ReactFlow {
        <<external xyflow>>
        +nodes, edges, nodeTypes
        Background, Controls, MiniMap
    }

    mainModule ..> Canvas : renders
    Canvas *-- CanvasInner
    CanvasInner ..> toReactFlow : useMemo
    toReactFlow ..> CanvasGraph : consumes
    CanvasInner ..> ReactFlow : renders
    ReactFlow ..> NODE_TYPES : resolves type
    NODE_TYPES ..> FlowNodeView
    NODE_TYPES ..> UnknownNodeView
    FlowNodeView ..> FlowNodeData : reads props.data
    FlowNodeView ..> KIND_GLYPH
    toReactFlow ..> FlowNodeData : builds
    CanvasInner ..> vscodeModule : send and onMessage
    vscodeModule --> VsCodeApi
    vscodeModule ..> WebviewToExtension : posts
    vscodeModule ..> ExtensionToWebview : receives
```

### The state that is deliberately missing

`CanvasInner` holds exactly three pieces of state — `graph`, `cursorNodeId`, `error` — and
**none of them is a node or an edge**. The `nodes`/`edges` handed to `<ReactFlow>` are a
`useMemo` over `toReactFlow(graph, cursorNodeId)`, recomputed only when a new parse arrives.

`onNodesChange` is where a conventional xyflow app would call `applyNodeChanges` and store the
result. This one ignores every change except `select`, which it forwards as a message. A dragged
node therefore snaps back to its parsed position and only moves once the file has been patched,
re-parsed and re-sent. That round trip is the architectural rule enforced inside React: the
canvas has no model, so there is no second model to diverge. `_addEdge` is re-exported from
xyflow at the bottom of the file but never called, for the same reason.

### Gesture → message → op

Each user gesture is one `WebviewToExtension` message; `FlowPanel.onMessage` turns it into one
`FlowOp`. Nothing in the webview edits text, and nothing in the extension draws.

| Gesture in the canvas | `CanvasInner` handler | Message sent | `FlowOp` built by `FlowPanel` |
|---|---|---|---|
| Drag a node, release | `onNodeDragStop` | `moveNode` | `moveNode` |
| Click a node | `onNodesChange` (select only) | `selectNode` | *none* — reveals in editor |
| Drag handle to handle | `onConnect` | `addEdge` | `addEdge`, id from `suggestEdgeId` |
| Delete key on a node | `onNodesDelete` | `deleteNode` | `deleteNode` |
| Delete key on an edge | `onEdgesDelete` | `deleteEdge` | `deleteEdge` |
| Double-click a node | `onNodeDoubleClick` | `renameNode` | `renameNode` |
| Double-click the pane | `onPaneDoubleClick` | `addNode` | `addNode`, id from `freshNodeId` |
| **+ Add node** button | `onAddNodeAtCentre` | `addNode` | `addNode`, id from `freshNodeId` |
| Webview finishes loading | `useEffect` | `ready` | *none* — triggers first parse |

An unparsable link is drawn as a `UnknownNodeView`, and reaching it is blocked twice over.
Every handler that receives a *node* checks `node.id.startsWith("unknown:")` and bails —
`onNodeDragStop` and `onNodeDoubleClick` return early, `onNodesDelete` skips, `onNodesChange`
reports the selection as `undefined`. The two handlers that do **not** check are `onConnect` and
`onEdgesDelete`, and neither needs to: `toReactFlow` gives unknown nodes `connectable: false`, so
no connection can start or end on one, and an edge is never unknown in the first place. The
result either way is that no gesture can produce an op against source twowayflow admitted it
could not read.

`FlowNodeView` reads `description` but nothing ever writes one: it renders as a sibling
`role="tooltip"` span wired up with `aria-describedby`, rather than a native `title`, so it can
wrap prose and follow the editor theme. `inSync` is the cursor-follows-canvas highlight — set by
`toReactFlow` when the node's id equals `cursorNodeId` from the last `reveal` message.

## 6. Cross-package dependency

```mermaid
classDiagram
    direction LR

    class dsl["@twowayflow/dsl"] {
        <<package>>
        FlowBuilder, flow()
        NodeKind, Position
        NodeOptions, EdgeOptions
        FlowSpec, NodeSpec, EdgeSpec
    }
    class core["@twowayflow/core"] {
        <<package>>
        parse: FlowFile with spans
        patch: FlowOp to TextEdit
        print, spans, text
    }
    class ext["vscode-ext/src — extension host"] {
        <<package>>
        FlowPanel, toCanvasGraph
        owns the parse and the edits
        node, has vscode API
    }
    class web["vscode-ext/webview — browser"] {
        <<package>>
        Canvas, FlowNodeView
        draws, owns nothing
        no fs, no vscode API
    }
    class webtreesitter["web-tree-sitter"] {
        <<external>>
    }
    class xyflow["@xyflow/react"] {
        <<external>>
    }
    class react["react + react-dom"] {
        <<external>>
    }

    core ..> dsl : NodeKind, Position, NODE_KINDS
    core ..> webtreesitter : parses with
    ext ..> core : parse and patch
    ext ..> dsl : the file imports it
    ext ..> web : serves html, posts graph
    web ..> ext : posts gestures
    web ..> xyflow : draws with
    web ..> react
    web ..> protocolTypes : type-only import
    ext ..> protocolTypes

    class protocolTypes["src/protocol.ts"] {
        <<shared types>>
        CanvasGraph, CanvasNode
        ExtensionToWebview
        WebviewToExtension
    }
```

The webview and the extension host are **separate runtimes** — different globals, no shared
memory, a `postMessage` channel between them. The only thing they share is `src/protocol.ts`,
imported `type`-only from the webview side, so the contract is compile-time and nothing of the
extension's code crosses into the browser. The arrow that does *not* exist is the important one:
the webview has no path to `@twowayflow/core`, so it cannot parse or patch even by accident.

The dependency only ever points one way, and `core` takes three names from `dsl`: `NodeKind` and
`Position` as `import type` in `model.ts`, `print.ts` and `patch.ts`, plus `NODE_KINDS` as a real
runtime import in `parse.ts` — the parser validates a `kind:` against the DSL's own vocabulary
rather than keeping a second copy of the list. That one value import is the only code that
crosses the boundary; everything else erases at compile time. The DSL knows nothing about
parsing, and nothing about the canvas.
