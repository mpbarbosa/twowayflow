import type { NodeKind, Position } from "@twowayflow/dsl";
import type { FlowGraphSpec } from "./model.js";

export const DEFAULT_INDENT = "  ";

/**
 * Whether `value` can be written as the kind of string literal this DSL uses.
 *
 * The parser refuses ids whose literal contains an escape sequence (docs/dsl.md §5), so the
 * printer must never emit one — otherwise print/parse would not round-trip. Rather than
 * silently mangling such an id, both sides reject it. Written as a loop rather than a regex
 * because the rejected set includes the two Unicode line separators, which cannot appear
 * literally inside a regex literal.
 */
export function isPlainLiteralBody(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '"' || char === "\\") return false;
    if (code < 0x20 || code === 0x7f) return false;
    if (code === 0x2028 || code === 0x2029) return false;
  }
  return true;
}

export class UnprintableIdentifierError extends Error {
  constructor(readonly value: string) {
    super(
      `"${value}" cannot be written as a plain string literal, so twowayflow cannot ` +
        "round-trip it. Node ids and labels may not contain quotes, backslashes, newlines " +
        "or control characters.",
    );
    this.name = "UnprintableIdentifierError";
  }
}

export function quote(value: string): string {
  if (!isPlainLiteralBody(value)) throw new UnprintableIdentifierError(value);
  return `"${value}"`;
}

export function printPosition(position: Position): string {
  return `[${position.x}, ${position.y}]`;
}

export interface NodeLinkFields {
  readonly id: string;
  readonly kind?: NodeKind;
  readonly label?: string;
  readonly position?: Position;
}

/**
 * Render a `.node(...)` link in canonical form.
 *
 * Canonical form only governs links the patcher *writes*. Links already in the file are never
 * reprinted — that is the whole architecture — so a hand-formatted file stays hand-formatted.
 */
export function printNodeLink(node: NodeLinkFields): string {
  const parts: string[] = [];
  if (node.kind !== undefined) parts.push(`kind: ${quote(node.kind)}`);
  if (node.position !== undefined) parts.push(`at: ${printPosition(node.position)}`);
  if (node.label !== undefined) parts.push(`label: ${quote(node.label)}`);
  const options = parts.length > 0 ? `, { ${parts.join(", ")} }` : "";
  return `.node(${quote(node.id)}${options})`;
}

export interface EdgeLinkFields {
  readonly from: string;
  readonly to: string;
  /** Written out only when the edge declares one; most edges do not need it. */
  readonly id?: string;
  readonly label?: string;
}

export function printEdgeLink(edge: EdgeLinkFields): string {
  const parts: string[] = [];
  if (edge.id !== undefined) parts.push(`id: ${quote(edge.id)}`);
  if (edge.label !== undefined) parts.push(`label: ${quote(edge.label)}`);
  const options = parts.length > 0 ? `, { ${parts.join(", ")} }` : "";
  return `.edge(${quote(edge.from)}, ${quote(edge.to)}${options})`;
}

export interface PrintOptions {
  readonly indent?: string;
  readonly importSpecifier?: string;
}

/**
 * Render a whole flow file in canonical form.
 *
 * Used for `twowayflow: new flow` and, more importantly, as the generator side of the
 * property tests: generate a graph, print it, parse it, and the parse must equal the graph.
 */
export function printFlowFile(spec: FlowGraphSpec, options: PrintOptions = {}): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const from = options.importSpecifier ?? "@twowayflow/dsl";
  const lines = [
    `import { flow } from ${quote(from)};`,
    "",
    `export default flow(${quote(spec.name ?? "untitled")})`,
  ];
  for (const node of spec.nodes) lines.push(indent + printNodeLink(node));
  for (const edge of spec.edges) lines.push(indent + printEdgeLink(edge));
  return `${lines.join("\n")};\n`;
}
