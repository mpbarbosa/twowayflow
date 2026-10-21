import type { NodeKind, Position } from "@twowayflow/dsl";
import type { ChainLink, Diagnostic, FlowFile, FlowGraphSpec, Span, TextEdit } from "./model.js";
import { edgeIds, sliceSpan } from "./model.js";
import {
  DEFAULT_INDENT,
  isPlainLiteralBody,
  printEdgeLink,
  printNodeLink,
  printPosition,
  quote,
} from "./print.js";
import { applyEdits, indentationAt, isInsideLineComment, whitespaceRunStart } from "./text.js";

export type FlowOp =
  | {
      readonly op: "addNode";
      readonly id: string;
      readonly kind?: NodeKind;
      readonly label?: string;
      readonly position?: Position;
    }
  | { readonly op: "deleteNode"; readonly id: string }
  | { readonly op: "renameNode"; readonly id: string; readonly newId: string }
  | { readonly op: "moveNode"; readonly id: string; readonly position: Position }
  | {
      readonly op: "addEdge";
      readonly from: string;
      readonly to: string;
      /**
       * Identity to declare for the new edge. The caller decides, because the decision depends
       * on the graph and the patcher must stay a pure function of the op: see
       * {@link suggestEdgeId}.
       */
      readonly id?: string;
      readonly label?: string;
    }
  | { readonly op: "deleteEdge"; readonly edgeId: string };

export interface PatchResult {
  /** Ranged edits against `file.source`. Never a whole-file replacement. */
  readonly edits: readonly TextEdit[];
  /** Things the caller should know but that did not stop the patch. */
  readonly warnings: readonly Diagnostic[];
}

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

/**
 * Turn canvas operations into ranged text edits against the current source.
 *
 * Every edit is computed against offsets in `file.source`, so a batch is coherent: offsets are
 * never rebased between ops. `applyEdits` sorts and applies them. Nothing is ever reprinted
 * that the user wrote by hand.
 */
export function patch(file: FlowFile, ops: readonly FlowOp[]): PatchResult {
  const edits: TextEdit[] = [];
  const warnings: Diagnostic[] = [];
  const deletions: PendingDeletion[] = [];
  const deleted = new Set<string>();

  for (const op of ops) {
    switch (op.op) {
      case "addNode":
        addNode(file, op, edits);
        break;
      case "deleteNode":
        deleteNode(file, op.id, deleted, deletions);
        break;
      case "renameNode":
        renameNode(file, op.id, op.newId, deleted, edits, warnings);
        break;
      case "moveNode":
        moveNode(file, op.id, op.position, deleted, edits);
        break;
      case "addEdge":
        addEdge(file, op, edits, warnings);
        break;
      case "deleteEdge":
        deleteEdge(file, op.edgeId, deletions);
        break;
    }
  }

  // Deletions are resolved last, together, because whether one of them strands code on a
  // comment line depends on what the *other* deletions in the same batch remove.
  return { edits: [...edits, ...resolveDeletions(file.source, deletions)], warnings };
}

/** `patch` plus `applyEdits`, for callers that just want the new source. */
export function applyPatch(
  file: FlowFile,
  ops: readonly FlowOp[],
): { source: string; edits: readonly TextEdit[]; warnings: readonly Diagnostic[] } {
  const { edits, warnings } = patch(file, ops);
  return { source: applyEdits(file.source, edits), edits, warnings };
}

// --------------------------------------------------------------------------------------------
// Insertion anchors
// --------------------------------------------------------------------------------------------

interface Anchor {
  readonly offset: number;
  /** Text to put before the new link: a newline plus indentation, or nothing. */
  readonly prefix: string;
}

/**
 * Where a new link goes, and how it should be introduced.
 *
 * If the chain is spread over several lines the new link gets its own line, indented like the
 * link it follows. If the whole chain is on one line it is appended inline, so a deliberate
 * one-liner stays a one-liner. An empty flow (`flow("x")` with no links yet) always goes
 * multi-line, because that is where a chain is heading anyway.
 */
function anchorAfter(file: FlowFile, link: ChainLink | undefined): Anchor {
  const src = file.source;

  if (!link) {
    const offset = file.rootCallSpan?.end;
    if (offset === undefined) {
      throw new PatchError("This file has no `flow(...)` call, so there is nothing to append to.");
    }
    const base = file.chainSpan ? indentationAt(src, file.chainSpan.start) : "";
    return { offset, prefix: `\n${base}${DEFAULT_INDENT}` };
  }

  const offset = endOfTrailingTrivia(src, link.span.end);
  const chainStart = file.chainSpan?.start ?? link.span.start;
  const multiline = src.slice(chainStart, link.span.start).includes("\n");
  return {
    offset,
    prefix: multiline ? `\n${indentationAt(src, link.span.start)}` : "",
  };
}

/**
 * Skip past whitespace and a trailing comment on the same line, so a newly inserted link does
 * not slide underneath a `// note` that belongs to the link before it.
 */
function endOfTrailingTrivia(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  const lineEnd = newline === -1 ? source.length : newline;
  const rest = source.slice(offset, lineEnd);
  if (/^\s*$/.test(rest)) return offset;
  if (/^\s*(\/\/[^\n]*|\/\*(?:(?!\*\/).)*\*\/)\s*$/.test(rest)) return lineEnd;
  return offset;
}

function lastLinkOf(links: readonly { readonly link: ChainLink }[]): ChainLink | undefined {
  let best: ChainLink | undefined;
  for (const { link } of links) {
    if (!best || link.span.start > best.span.start) best = link;
  }
  return best;
}

function nodeAnchor(file: FlowFile): Anchor {
  return anchorAfter(file, lastLinkOf(file.nodes));
}

function edgeAnchor(file: FlowFile): Anchor {
  return anchorAfter(file, lastLinkOf(file.edges) ?? lastLinkOf(file.nodes));
}

// --------------------------------------------------------------------------------------------
// Operations
// --------------------------------------------------------------------------------------------

function requireNode(file: FlowFile, id: string, deleted: Set<string>) {
  if (deleted.has(id)) {
    throw new PatchError(
      `Node "${id}" is deleted earlier in this same batch; later ops on it would produce ` +
        "overlapping edits. Split the batch.",
    );
  }
  const node = file.nodes.find((n) => n.id === id);
  if (!node) throw new PatchError(`No node "${id}" in this file.`);
  return node;
}

function addNode(file: FlowFile, op: Extract<FlowOp, { op: "addNode" }>, edits: TextEdit[]): void {
  if (!isPlainLiteralBody(op.id)) {
    throw new PatchError(`Node id ${JSON.stringify(op.id)} cannot be written as a plain literal.`);
  }
  if (file.nodes.some((n) => n.id === op.id)) {
    throw new PatchError(`Node "${op.id}" already exists.`);
  }
  const { offset, prefix } = nodeAnchor(file);
  edits.push({
    range: { start: offset, end: offset },
    newText: prefix + printNodeLink(op),
    reason: `add node "${op.id}"`,
  });
}

function deleteNode(
  file: FlowFile,
  id: string,
  deleted: Set<string>,
  deletions: PendingDeletion[],
): void {
  const node = requireNode(file, id, deleted);
  deleted.add(id);
  deletions.push({ link: node.link, reason: `delete node "${id}"` });
  for (const edge of file.edges) {
    if (edge.from === id || edge.to === id) {
      deletions.push({ link: edge.link, reason: `delete edge "${edge.id}" with node "${id}"` });
    }
  }
}

function renameNode(
  file: FlowFile,
  id: string,
  newId: string,
  deleted: Set<string>,
  edits: TextEdit[],
  warnings: Diagnostic[],
): void {
  const node = requireNode(file, id, deleted);
  if (!isPlainLiteralBody(newId)) {
    throw new PatchError(`Node id ${JSON.stringify(newId)} cannot be written as a plain literal.`);
  }
  if (newId === "") throw new PatchError("A node id cannot be empty.");
  if (newId !== id && file.nodes.some((n) => n.id === newId)) {
    throw new PatchError(`Node "${newId}" already exists.`);
  }
  if (newId === id) return;

  edits.push({ range: node.idSpan, newText: newId, reason: `rename "${id}" to "${newId}"` });
  for (const edge of file.edges) {
    if (edge.from === id) {
      edits.push({ range: edge.fromSpan, newText: newId, reason: `retarget edge ${edge.id}` });
    }
    if (edge.to === id) {
      edits.push({ range: edge.toSpan, newText: newId, reason: `retarget edge ${edge.id}` });
    }
  }

  if (file.unknownLinks.length > 0) {
    warnings.push({
      code: "unparsable-link",
      severity: "warning",
      message:
        `Renamed "${id}" to "${newId}", but this file has ${file.unknownLinks.length} link(s) ` +
        "twowayflow cannot read. If any of them references the old id, it was not updated.",
      span: file.unknownLinks[0]!.link.span,
    });
  }
}

function moveNode(
  file: FlowFile,
  id: string,
  position: Position,
  deleted: Set<string>,
  edits: TextEdit[],
): void {
  const node = requireNode(file, id, deleted);
  const text = printPosition(position);

  // Case 1: the node already has an `at`. Overwrite exactly that array literal.
  if (node.positionSpan) {
    edits.push({ range: node.positionSpan, newText: text, reason: `move node "${id}"` });
    return;
  }

  // Case 2: it has an options object but no `at`.
  if (node.optionsSpan) {
    const objectText = sliceSpan(file.source, node.optionsSpan);
    if (/^\{\s*\}$/.test(objectText)) {
      // An empty object has no unambiguous insertion point, so replace the whole thing.
      edits.push({
        range: node.optionsSpan,
        newText: `{ at: ${text} }`,
        reason: `give node "${id}" a position`,
      });
      return;
    }
    // Immediately after `{` is the one place in a non-empty object literal where inserting
    // never has to reason about whether a trailing comma is already present.
    const after = node.optionsSpan.start + 1;
    const needsSpace = !/\s/.test(file.source[after] ?? "");
    edits.push({
      range: { start: after, end: after },
      newText: ` at: ${text},${needsSpace ? " " : ""}`,
      reason: `give node "${id}" a position`,
    });
    return;
  }

  // Case 3: no options object at all. Append one as a second argument, right after the closing
  // quote of the id literal — which is where the first argument provably ends.
  const afterIdLiteral = node.idSpan.end + 1;
  edits.push({
    range: { start: afterIdLiteral, end: afterIdLiteral },
    newText: `, { at: ${text} }`,
    reason: `give node "${id}" a position`,
  });
}

function addEdge(
  file: FlowFile,
  op: Extract<FlowOp, { op: "addEdge" }>,
  edits: TextEdit[],
  warnings: Diagnostic[],
): void {
  for (const id of [op.from, op.to]) {
    if (!isPlainLiteralBody(id) || id === "") {
      throw new PatchError(`Edge endpoint ${JSON.stringify(id)} is not a usable node id.`);
    }
    if (!file.nodes.some((n) => n.id === id)) {
      warnings.push({
        code: "dangling-edge",
        severity: "warning",
        message: `Added an edge referencing "${id}", which is not declared in this file.`,
        span: file.chainSpan ?? { start: 0, end: 0 },
      });
    }
  }
  if (op.id !== undefined) {
    if (!isPlainLiteralBody(op.id) || op.id === "") {
      throw new PatchError(
        `Edge id ${JSON.stringify(op.id)} cannot be written as a plain literal.`,
      );
    }
    if (file.edges.some((e) => e.id === op.id)) {
      throw new PatchError(`Edge "${op.id}" already exists.`);
    }
  }
  const { offset, prefix } = edgeAnchor(file);
  edits.push({
    range: { start: offset, end: offset },
    newText: prefix + printEdgeLink(op),
    reason: `add edge ${op.from}->${op.to}`,
  });
}

function deleteEdge(file: FlowFile, edgeId: string, deletions: PendingDeletion[]): void {
  const matches = file.edges.filter((e) => e.id === edgeId);
  if (matches.length === 0) throw new PatchError(`No edge "${edgeId}" in this file.`);
  // Two edges can only share an id if the file declares the same id twice, which the parser
  // already reports as `duplicate-edge-id`. Deleting an arbitrary one of them would be a guess.
  if (matches.length > 1) {
    throw new PatchError(
      `Edge id "${edgeId}" identifies ${matches.length} edges in this file, so it is ambiguous. ` +
        "Give each of them a distinct `id` first.",
    );
  }
  deletions.push({ link: matches[0]!.link, reason: `delete edge "${edgeId}"` });
}

/**
 * The id a new `from` -> `to` edge should declare, or `undefined` when it needs none.
 *
 * The first edge of a pair needs no declared id: its positional identity `from->to` is already
 * stable, and writing an id for it would put noise in every file. Any *later* edge of the same
 * pair gets one, because that is exactly the case where positional identity stops being stable.
 * The suggested id is the string the positional scheme would have produced anyway, so nothing
 * the user sees changes shape — the identity simply becomes something written down rather than
 * counted.
 *
 * This is deliberately not done inside `patch()`. An id chosen from the graph is a function of
 * the graph, and `patch()` computes a whole batch against one snapshot: if it picked the id
 * itself, `[deleteEdge("a->b"), addEdge("a","b")]` would choose `a->b#1` from the snapshot while
 * the sequential model, having already removed `a->b`, would choose no id at all. Keeping the id
 * in the op makes the patcher a pure function of its ops and keeps batches well defined. The
 * caller — the extension, which has just re-parsed — calls this and passes the answer in.
 *
 * `edges` may be either `FlowEdge`s (whose `id` is already resolved) or spec edges (whose `id`
 * is the declared one, if any): resolving an already-resolved list is the identity.
 */
export function suggestEdgeId(
  edges: readonly { readonly from: string; readonly to: string; readonly id?: string }[],
  from: string,
  to: string,
): string | undefined {
  const pair = `${from}->${to}`;
  if (!edges.some((e) => `${e.from}->${e.to}` === pair)) return undefined;
  const taken = new Set(edgeIds(edges));
  for (let n = 1; ; n += 1) {
    const candidate = `${pair}#${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

interface PendingDeletion {
  readonly link: ChainLink;
  readonly reason: string;
}

interface ResolvedDeletion {
  readonly start: number;
  readonly end: number;
  readonly link: ChainLink;
  readonly reason: string;
  newText: string;
}

/**
 * Turn pending link deletions into edits.
 *
 * A link's deletion range is the link itself plus the *whitespace-only* run before it.
 * Whitespace-only is the load-bearing word: a comment between two links falls outside every
 * deletion range, so deleting a node can never silently eat one. That is the invariant the
 * property suite checks, and it is the one that previous generations of round-trip tools got
 * wrong.
 *
 * The cost is that a deletion can leave the rest of the chain stranded on a `//` line, which
 * would comment out live code. When that would happen the empty replacement becomes a newline
 * plus indentation instead. Deciding it needs the whole batch: two adjacent deletions each look
 * harmless alone and together move a `;` onto a comment line, so the deletions are resolved
 * back-to-front, each one seeing what the ones after it already decided to leave behind.
 */
function resolveDeletions(source: string, deletions: readonly PendingDeletion[]): TextEdit[] {
  const resolved: ResolvedDeletion[] = deletions
    .map((d) => ({
      start: whitespaceRunStart(source, d.link.span.start, d.link.leadingTriviaStart),
      end: d.link.span.end,
      link: d.link,
      reason: d.reason,
      newText: "",
    }))
    .sort((a, b) => a.start - b.start);

  for (let i = resolved.length - 1; i >= 0; i -= 1) {
    const deletion = resolved[i]!;
    if (!isInsideLineComment(source, deletion.start)) continue;
    const rest = survivingRestOfLine(source, deletion.end, resolved.slice(i + 1));
    if (!/^\s*$/.test(rest)) {
      deletion.newText = `\n${indentationAt(source, deletion.link.span.start)}`;
    }
  }

  return resolved.map((d) => ({
    range: { start: d.start, end: d.end },
    newText: d.newText,
    reason: d.reason,
  }));
}

/**
 * What will still be on this line after `from`, once `later` deletions have been applied.
 * Stops at the first newline that survives — including one contributed by a later deletion's
 * own replacement text.
 */
function survivingRestOfLine(
  source: string,
  from: number,
  later: readonly ResolvedDeletion[],
): string {
  let out = "";
  let pos = from;

  while (pos < source.length) {
    const covering = later.find((d) => d.start <= pos && pos < d.end);
    if (covering) {
      const newlineAt = covering.newText.indexOf("\n");
      if (newlineAt !== -1) return out + covering.newText.slice(0, newlineAt);
      out += covering.newText;
      pos = covering.end;
      continue;
    }
    const char = source[pos]!;
    if (char === "\n") break;
    out += char;
    pos += 1;
  }

  return out;
}

// --------------------------------------------------------------------------------------------
// The model-side reference implementation
// --------------------------------------------------------------------------------------------

type SpecNode = FlowGraphSpec["nodes"][number];
type SpecEdge = FlowGraphSpec["edges"][number];

/**
 * Apply the same ops to the span-free model.
 *
 * This is the other half of the round-trip property: `parse(applyEdits(src, patch(ops)))` must
 * equal `applyOpsToSpec(parse(src), ops)`. If they ever disagree, the text patcher and the
 * model have different ideas about what an operation means, which is the exact failure mode
 * that killed every previous generation of round-trip tool.
 */
export function applyOpsToSpec(spec: FlowGraphSpec, ops: readonly FlowOp[]): FlowGraphSpec {
  let nodes: SpecNode[] = [...spec.nodes];
  let edges: SpecEdge[] = [...spec.edges];

  for (const op of ops) {
    switch (op.op) {
      case "addNode": {
        nodes = [
          ...nodes,
          {
            id: op.id,
            ...(op.kind === undefined ? {} : { kind: op.kind }),
            ...(op.label === undefined ? {} : { label: op.label }),
            ...(op.position === undefined ? {} : { position: op.position }),
          },
        ];
        break;
      }
      case "deleteNode": {
        nodes = nodes.filter((n) => n.id !== op.id);
        edges = edges.filter((e) => e.from !== op.id && e.to !== op.id);
        break;
      }
      case "renameNode": {
        nodes = nodes.map((n) => (n.id === op.id ? { ...n, id: op.newId } : n));
        edges = edges.map((e) => ({
          ...e,
          ...(e.from === op.id ? { from: op.newId } : {}),
          ...(e.to === op.id ? { to: op.newId } : {}),
        }));
        break;
      }
      case "moveNode": {
        nodes = nodes.map((n) => (n.id === op.id ? { ...n, position: op.position } : n));
        break;
      }
      case "addEdge": {
        edges = [
          ...edges,
          {
            from: op.from,
            to: op.to,
            ...(op.id === undefined ? {} : { id: op.id }),
            ...(op.label === undefined ? {} : { label: op.label }),
          },
        ];
        break;
      }
      case "deleteEdge": {
        const ids = edgeIds(edges);
        edges = edges.filter((_, i) => ids[i] !== op.edgeId);
        break;
      }
    }
  }

  return { ...(spec.name === undefined ? {} : { name: spec.name }), nodes, edges };
}

/** Spans the patcher is allowed to touch, for the "unknown links stay untouched" assertion. */
export function untouchedSpansFor(file: FlowFile): Span[] {
  return file.unknownLinks.map((u) => u.link.span);
}

export { quote };
