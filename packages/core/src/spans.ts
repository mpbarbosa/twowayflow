import { type ChainLink, type FlowFile, type Span, sliceSpan, spanContains } from "./model.js";
import { printPosition } from "./print.js";

/** Every top-level chain link in the file, in source order. */
export function allLinks(file: FlowFile): ChainLink[] {
  return [
    ...file.nodes.map((n) => n.link),
    ...file.edges.map((e) => e.link),
    ...file.unknownLinks.map((u) => u.link),
  ].sort((a, b) => a.span.start - b.span.start);
}

export class SpanTilingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpanTilingError";
  }
}

/**
 * Rebuild the source from the recorded link spans plus the gaps between them.
 *
 * This is the span-provenance test made executable. The result is trivially equal to the input
 * *only if* the recorded spans are in order, non-overlapping and within bounds — which is
 * exactly the precondition byte-range patching needs. Any violation throws rather than quietly
 * producing a string that happens to match.
 */
export function reassembleFromLinks(file: FlowFile): string {
  const links = allLinks(file);
  let out = "";
  let cursor = 0;

  for (const link of links) {
    const { start, end } = link.span;
    if (start > end) {
      throw new SpanTilingError(`Link .${link.method} has an inverted span [${start},${end})`);
    }
    if (end > file.source.length) {
      throw new SpanTilingError(
        `Link .${link.method} span [${start},${end}) runs past the end of a ` +
          `${file.source.length}-char source`,
      );
    }
    if (start < cursor) {
      throw new SpanTilingError(
        `Link .${link.method} span [${start},${end}) overlaps the previous link, which ` +
          `ended at ${cursor}`,
      );
    }
    out += file.source.slice(cursor, start) + sliceSpan(file.source, link.span);
    cursor = end;
  }

  return out + file.source.slice(cursor);
}

export interface SpanViolation {
  readonly what: string;
  readonly detail: string;
  readonly span: Span;
}

/**
 * Check that every recorded sub-span really does point at the text it claims to, and nests
 * inside its parent.
 *
 * Reassembly proves the link spans tile the file. This proves the *inner* spans — the ones the
 * patcher actually writes through — are exact. Between them they are the "span provenance"
 * risk from the tech-stack assessment, stated as something a test can fail.
 */
export function checkSpanInvariants(file: FlowFile): SpanViolation[] {
  const violations: SpanViolation[] = [];
  const src = file.source;

  const check = (ok: boolean, what: string, detail: string, span: Span) => {
    if (!ok) violations.push({ what, detail, span });
  };

  if (file.nameSpan) {
    check(
      sliceSpan(src, file.nameSpan) === file.name,
      "flow name",
      `span holds ${JSON.stringify(sliceSpan(src, file.nameSpan))} but name is ` +
        JSON.stringify(file.name),
      file.nameSpan,
    );
  }

  for (const node of file.nodes) {
    check(
      sliceSpan(src, node.idSpan) === node.id,
      `node ${node.id} idSpan`,
      `span holds ${JSON.stringify(sliceSpan(src, node.idSpan))}`,
      node.idSpan,
    );
    check(
      spanContains(node.link.span, node.idSpan),
      `node ${node.id} idSpan`,
      "idSpan is not inside its own chain link",
      node.idSpan,
    );

    if (node.optionsSpan) {
      const text = sliceSpan(src, node.optionsSpan);
      check(
        text.startsWith("{") && text.endsWith("}"),
        `node ${node.id} optionsSpan`,
        `span holds ${JSON.stringify(text.slice(0, 40))}`,
        node.optionsSpan,
      );
      check(
        spanContains(node.link.span, node.optionsSpan),
        `node ${node.id} optionsSpan`,
        "optionsSpan is not inside its own chain link",
        node.optionsSpan,
      );
    }

    if (node.positionSpan) {
      const text = sliceSpan(src, node.positionSpan);
      check(
        text.replace(/\s+/g, " ") === printPosition(node.position!).replace(/\s+/g, " ") ||
          /^\[\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\]$/.test(text),
        `node ${node.id} positionSpan`,
        `span holds ${JSON.stringify(text)} for position ${JSON.stringify(node.position)}`,
        node.positionSpan,
      );
      check(
        !!node.optionsSpan && spanContains(node.optionsSpan, node.positionSpan),
        `node ${node.id} positionSpan`,
        "positionSpan is not inside the options object",
        node.positionSpan,
      );
    }

    check(
      node.position === undefined || node.positionSpan !== undefined,
      `node ${node.id}`,
      "has a position but no positionSpan, so it could never be moved",
      node.link.span,
    );
  }

  for (const edge of file.edges) {
    check(
      sliceSpan(src, edge.fromSpan) === edge.from,
      `edge ${edge.id} fromSpan`,
      `span holds ${JSON.stringify(sliceSpan(src, edge.fromSpan))}`,
      edge.fromSpan,
    );
    check(
      sliceSpan(src, edge.toSpan) === edge.to,
      `edge ${edge.id} toSpan`,
      `span holds ${JSON.stringify(sliceSpan(src, edge.toSpan))}`,
      edge.toSpan,
    );
    check(
      spanContains(edge.link.span, edge.fromSpan) && spanContains(edge.link.span, edge.toSpan),
      `edge ${edge.id}`,
      "endpoint spans are not inside their own chain link",
      edge.link.span,
    );
  }

  for (const link of allLinks(file)) {
    const text = sliceSpan(src, link.span);
    check(
      text.startsWith("."),
      `link .${link.method}`,
      `link span should start at the dot but holds ${JSON.stringify(text.slice(0, 20))}`,
      link.span,
    );
    check(
      text.endsWith(")"),
      `link .${link.method}`,
      `link span should end at the closing paren but holds ` +
        JSON.stringify(text.slice(Math.max(0, text.length - 20))),
      link.span,
    );
    check(
      link.leadingTriviaStart <= link.span.start,
      `link .${link.method}`,
      "leadingTriviaStart is after the link starts",
      link.span,
    );
    check(
      /^\s*$/.test(src.slice(link.leadingTriviaStart, link.span.start)) ||
        src.slice(link.leadingTriviaStart, link.span.start).includes("/"),
      `link .${link.method}`,
      "the gap before the link is neither whitespace nor a comment",
      { start: link.leadingTriviaStart, end: link.span.start },
    );
  }

  return violations;
}
