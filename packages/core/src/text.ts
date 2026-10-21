import type { Span, TextEdit } from "./model.js";

export class OverlappingEditsError extends Error {
  constructor(
    readonly a: TextEdit,
    readonly b: TextEdit,
  ) {
    super(
      `Overlapping edits: [${a.range.start},${a.range.end}) "${a.reason}" overlaps ` +
        `[${b.range.start},${b.range.end}) "${b.reason}"`,
    );
    this.name = "OverlappingEditsError";
  }
}

/**
 * Apply ranged edits to a source string.
 *
 * Edits are sorted by start offset, ties broken by their original order so that several
 * insertions at the same point come out in the order the patcher produced them. Overlapping
 * edits are a bug in the patcher, not a condition to paper over, so they throw.
 */
export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => a.edit.range.start - b.edit.range.start || a.index - b.index);

  let out = "";
  let cursor = 0;
  let previous: TextEdit | undefined;

  for (const { edit } of ordered) {
    const { start, end } = edit.range;
    if (start < 0 || end > source.length || start > end) {
      throw new RangeError(
        `Edit range [${start},${end}) out of bounds for a ${source.length}-char source ` +
          `("${edit.reason}")`,
      );
    }
    if (start < cursor) {
      // A zero-width insertion exactly at the previous edit's end is fine; a real overlap is not.
      throw new OverlappingEditsError(previous!, edit);
    }
    out += source.slice(cursor, start) + edit.newText;
    cursor = end;
    previous = edit;
  }

  return out + source.slice(cursor);
}

/** Net change in length that `edits` applies before `offset`. */
export function shiftOffset(offset: number, edits: readonly TextEdit[]): number {
  let delta = 0;
  for (const edit of edits) {
    if (edit.range.end <= offset)
      delta += edit.newText.length - (edit.range.end - edit.range.start);
  }
  return offset + delta;
}

const WHITESPACE = /\s/;

/** Start of the whitespace-only run ending at `end`, not reaching below `floor`. */
export function whitespaceRunStart(source: string, end: number, floor: number): number {
  let i = end;
  while (i > floor && WHITESPACE.test(source[i - 1]!)) i -= 1;
  return i;
}

/** The indentation (leading whitespace) of the line containing `offset`. */
export function indentationAt(source: string, offset: number): string {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const match = /^[ \t]*/.exec(source.slice(lineStart, offset));
  return match?.[0] ?? "";
}

/**
 * True when `offset` sits on a line whose remaining text has been commented out by a `//`
 * earlier on the same line. Deleting a chain link can leave the following `;` stranded on such
 * a line, so the patcher has to know.
 */
export function isInsideLineComment(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const line = source.slice(lineStart, offset);
  let inString: string | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === inString) inString = undefined;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") return true;
  }
  return false;
}

/**
 * The best insertion point at or after `offset`: the end of the current line, when everything
 * between `offset` and the newline is whitespace and/or comments.
 *
 * This keeps a trailing `// note` attached to the link it was written for, instead of having a
 * newly inserted link slide underneath it.
 */
export function endOfTrailingTrivia(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);
  const lineEnd = newline === -1 ? source.length : newline;
  const rest = source.slice(offset, lineEnd);
  // Whitespace, then optionally a line comment or a single-line block comment, then whitespace.
  if (/^\s*(\/\/[^\n]*|\/\*(?:(?!\*\/)[^\n])*\*\/\s*)?$/.test(rest)) {
    return /^\s*$/.test(rest) ? offset : lineEnd;
  }
  return offset;
}

/**
 * All comment tokens in `source`, in order. Used by the comment-preservation property test.
 *
 * This is a deliberately small scanner, not a lexer: it tracks string and template literals but
 * not regex literals, so `/\/\//` would be misread. The test corpus contains no regex literals.
 * If that ever changes, read comments off the tree-sitter tree instead.
 */
export function extractComments(source: string): string[] {
  const comments: string[] = [];
  let i = 0;
  let inString: string | undefined;
  while (i < source.length) {
    const ch = source[i]!;
    if (inString) {
      if (ch === "\\") i += 2;
      else {
        if (ch === inString) inString = undefined;
        i += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      comments.push(source.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      comments.push(source.slice(i, stop));
      i = stop;
      continue;
    }
    i += 1;
  }
  return comments;
}

export function spanOf(start: number, end: number): Span {
  return { start, end };
}
