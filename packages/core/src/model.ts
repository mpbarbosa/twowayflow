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
  /** `from->to`, suffixed `#n` when the same pair is declared more than once. */
  readonly id: string;
  readonly from: string;
  readonly fromSpan: Span;
  readonly to: string;
  readonly toSpan: Span;
  readonly label?: string;
  readonly optionsSpan?: Span;
  readonly link: ChainLink;
}

export type DiagnosticCode =
  | "no-flow-chain"
  | "unparsable-link"
  | "duplicate-node-id"
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
