import type { FlowFile } from "@twowayflow/core";
import { sliceSpan } from "@twowayflow/core";
import type { CanvasGraph } from "./protocol.js";

/** Fallback layout for nodes that have no `at` in the source yet. */
const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 140;

export function toCanvasGraph(file: FlowFile, revision: number): CanvasGraph {
  let autoIndex = 0;

  return {
    ...(file.name === undefined ? {} : { name: file.name }),
    nodes: file.nodes.map((node) => {
      const position =
        node.position ??
        (() => {
          const i = autoIndex++;
          return { x: (i % 4) * COLUMN_WIDTH, y: Math.floor(i / 4) * ROW_HEIGHT + 400 };
        })();
      return {
        id: node.id,
        ...(node.kind === undefined ? {} : { kind: node.kind }),
        ...(node.label === undefined ? {} : { label: node.label }),
        ...(node.description === undefined ? {} : { description: node.description }),
        position,
        span: node.link.span,
        hasExplicitPosition: node.position !== undefined,
      };
    }),
    edges: file.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      span: edge.link.span,
    })),
    unknown: file.unknownLinks.map((unknown, i) => ({
      id: `unknown:${i}`,
      text: sliceSpan(file.source, unknown.link.span),
      reason: unknown.reason,
      span: unknown.link.span,
    })),
    diagnostics: file.diagnostics,
    revision,
  };
}
