/** The vocabulary of node kinds the canvas knows how to draw. */
export const NODE_KINDS = ["source", "transform", "filter", "fanout", "join", "sink"] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export interface Position {
  readonly x: number;
  readonly y: number;
}

/**
 * Options on a `.node(...)` link.
 *
 * `kind`, `at` and `label` are the only keys the canvas reads. Everything else is opaque
 * payload for whatever runtime executes the flow, and the patcher is required to leave it
 * byte-for-byte alone. See docs/dsl.md.
 */
export interface NodeOptions {
  readonly kind?: NodeKind;
  /** Canvas position as `[x, y]`. Optional: absent means "auto-layout me". */
  readonly at?: readonly [number, number];
  readonly label?: string;
  /** Opaque, runtime-defined payload. Never touched by the canvas or the patcher. */
  readonly [key: string]: unknown;
}

/**
 * Options on an `.edge(...)` link.
 *
 * `id` and `label` are the only keys the canvas reads; everything else is opaque payload, as on
 * a node. See docs/dsl.md.
 */
export interface EdgeOptions {
  /**
   * Declared identity for this edge, exactly as `.node(id, ...)` declares a node's.
   *
   * Optional, and absent in most files. An edge without one is identified *positionally* —
   * `from->to`, suffixed `#n` for the n-th undeclared edge of that pair — which is only as
   * stable as its undeclared siblings. Declare an id on each of a set of parallel edges and
   * deleting one of them leaves the others' identities alone.
   */
  readonly id?: string;
  readonly label?: string;
  readonly [key: string]: unknown;
}

/** A flow materialised as plain data, for a runtime to execute or a test to compare. */
export interface FlowSpec {
  readonly name: string;
  readonly nodes: readonly NodeSpec[];
  readonly edges: readonly EdgeSpec[];
}

export interface NodeSpec {
  readonly id: string;
  readonly kind?: NodeKind;
  readonly label?: string;
  readonly position?: Position;
  readonly options: Readonly<Record<string, unknown>>;
}

export interface EdgeSpec {
  readonly from: string;
  readonly to: string;
  /** The declared `id`, when the source gives one. Absent means "identify me positionally". */
  readonly id?: string;
  readonly label?: string;
}
