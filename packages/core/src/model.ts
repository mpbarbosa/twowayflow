import type { NodeKind, Position } from "@twowayflow/dsl";

/**
 * A half-open byte range into the source file: `[start, end)`.
 *
 * "Byte" is the right word even though we hold JavaScript strings: tree-sitter reports UTF-8
 * byte offsets, which are divided by two to give UTF-16 code-unit indices. All offsets in this
 * package are UTF-16 code-unit indices into `FlowFile.source`, i.e. directly usable with
 * `String.prototype.slice` and with VS Code's `Position`/`Range`.
 */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** A replacement of one source range. The only thing the patcher is allowed to emit. */
export interface TextEdit {
  readonly range: Span;
  readonly newText: string;
  /** Human-readable reason, for debugging and for the extension's undo label. */
  readonly reason: string;
}

/**
 * One `.method(...)` link in the builder chain.
 *
 * `span` is tight: it starts at the `.` and ends at the closing `)`. `leadingTriviaStart` is
 * where the gap from the previous link begins, which is what a deletion needs in order to take
 * the newline and indentation with it.
 */
export interface ChainLink {
  readonly method: string;
  readonly span: Span;
  readonly leadingTriviaStart: number;
  readonly index: number;
}

export type UnparsableReason =
  | "unknown-method"
  | "non-literal-id"
  | "empty-id"
  | "optional-chain"
  | "bad-arity"
  | "syntax-error";

export interface UnknownLink {
  readonly link: ChainLink;
  readonly reason: UnparsableReason;
}

export interface FlowNode {
  readonly id: string;
  /** The span *between* the quotes of the id literal. Renaming replaces exactly this. */
  readonly idSpan: Span;
  readonly kind?: NodeKind;
  readonly label?: string;
  readonly position?: Position;
  /** The `[x, y]` array literal including brackets. Moving replaces exactly this. */
  readonly positionSpan?: Span;
  /** The `{ ... }` options object including braces, if present. */
  readonly optionsSpan?: Span;
  readonly link: ChainLink;
}

export interface FlowEdge {
  /**
   * This edge's identity: its declared `id` when the source gives one, otherwise the positional
   * fallback `from->to`, suffixed `#n` for the n-th *undeclared* edge of that pair. See
   * {@link edgeIds}.
   */
  readonly id: string;
  /** The `id` option as written, when this edge declares one. */
  readonly declaredId?: string;
  /**
   * The span *between* the quotes of the declared id literal, present only when `declaredId`
   * is. Renaming an edge replaces exactly this, mirroring {@link FlowNode.idSpan}.
   */
  readonly idSpan?: Span;
  readonly from: string;
  readonly fromSpan: Span;
  readonly to: string;
  readonly toSpan: Span;
  readonly label?: string;
  readonly optionsSpan?: Span;
  readonly link: ChainLink;
}

/** An edge as the parser reads it, before identity is resolved across the whole file. */
export type FlowEdgeDraft = Omit<FlowEdge, "id">;

/**
 * Resolve the identity of every edge in a list, in source order.
 *
 * A declared `id` is that edge's identity verbatim. An edge without one falls back to the
 * positional scheme: `from->to` for the first *undeclared* edge of that pair, then `#1`, `#2`
 * and so on.
 *
 * Counting only undeclared edges is the load-bearing detail. It means declaring an id on one of
 * a set of parallel edges does not renumber the others, and — since the canvas declares an id
 * on every parallel edge it creates — a pair with at most one undeclared edge has an identity
 * for each of its edges that survives any of the others being deleted. Positional identity
 * remains fragile in the one case the tool never authors: a hand-written pair with two or more
 * undeclared edges, where deleting the first still renumbers the rest.
 *
 * This is the single implementation of edge identity. The parser uses it, and so does the
 * span-free model the patcher is checked against, which is what lets the two be compared at all.
 */
export function edgeIds(
  edges: readonly { readonly from: string; readonly to: string; readonly id?: string }[],
): string[] {
  const counts = new Map<string, number>();
  return edges.map((edge) => {
    if (edge.id !== undefined) return edge.id;
    const base = `${edge.from}->${edge.to}`;
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    return seen === 0 ? base : `${base}#${seen}`;
  });
}

export type DiagnosticCode =
  | "no-flow-chain"
  | "unparsable-link"
  | "duplicate-node-id"
  | "duplicate-edge-id"
  | "dangling-edge"
  | "syntax-error";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly span: Span;
}

/** The parse of one `*.flow.ts` file: a graph where everything carries its source span. */
export interface FlowFile {
  readonly source: string;
  readonly name?: string;
  /** The span between the quotes of the flow name literal. */
  readonly nameSpan?: Span;
  /** The whole `flow("x").node(...)...` expression. */
  readonly chainSpan?: Span;
  /** Just the `flow("x")` call, the fallback insertion anchor for an empty flow. */
  readonly rootCallSpan?: Span;
  readonly nodes: readonly FlowNode[];
  readonly edges: readonly FlowEdge[];
  readonly unknownLinks: readonly UnknownLink[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Span-free projection of a parse, for comparing a patched file against a patched model. */
export interface FlowGraphSpec {
  readonly name?: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly kind?: NodeKind;
    readonly label?: string;
    readonly position?: Position;
  }[];
  readonly edges: readonly {
    readonly from: string;
    readonly to: string;
    /** The declared id only. Positional ids are derived, so recording one would be a lie. */
    readonly id?: string;
    readonly label?: string;
  }[];
}

export function specOf(file: FlowFile): FlowGraphSpec {
  return {
    ...(file.name === undefined ? {} : { name: file.name }),
    nodes: file.nodes.map((n) => ({
      id: n.id,
      ...(n.kind === undefined ? {} : { kind: n.kind }),
      ...(n.label === undefined ? {} : { label: n.label }),
      ...(n.position === undefined ? {} : { position: n.position }),
    })),
    edges: file.edges.map((e) => ({
      from: e.from,
      to: e.to,
      ...(e.declaredId === undefined ? {} : { id: e.declaredId }),
      ...(e.label === undefined ? {} : { label: e.label }),
    })),
  };
}

export function sliceSpan(source: string, span: Span): string {
  return source.slice(span.start, span.end);
}

export function spanContains(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}
