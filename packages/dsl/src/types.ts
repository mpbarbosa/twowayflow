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

export interface EdgeOptions {
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
  readonly label?: string;
}
