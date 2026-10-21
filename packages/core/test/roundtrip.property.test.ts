import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyOpsToSpec,
  applyPatch,
  checkSpanInvariants,
  edgeIds,
  extractComments,
  type FlowFile,
  type FlowGraphSpec,
  type FlowOp,
  getParser,
  parseFlowSourceWith,
  printFlowFile,
  reassembleFromLinks,
  sliceSpan,
  specOf,
} from "../src/index.js";
import {
  arbGraph,
  arbOpIntent,
  arbRenderStyle,
  arbStableGraph,
  renderFlow,
  resolveIntent,
} from "./arbitraries.js";
import { example, exampleNames, fixture, fixtureNames } from "./helpers.js";

let parse: (source: string) => FlowFile;

beforeAll(async () => {
  const parser = await getParser();
  parse = (source) => parseFlowSourceWith(parser, source);
});

/** Deliberately low: each run parses a file through a WASM grammar. Raise locally to hunt. */
const RUNS = Number(process.env.TWF_FC_RUNS ?? 150);
const config = { numRuns: RUNS, verbose: false } as const;

// --------------------------------------------------------------------------------------------
// Property 1 — the parse is lossless
// --------------------------------------------------------------------------------------------

describe("print(parse(src)) === src", () => {
  it("holds across a generated corpus", () => {
    fc.assert(
      fc.property(arbGraph, arbRenderStyle, (graph, style) => {
        const { source } = renderFlow(graph, style);
        expect(reassembleFromLinks(parse(source))).toBe(source);
      }),
      config,
    );
  });

  it.each([...fixtureNames()])("holds for the %s fixture", (name) => {
    const source = fixture(name);
    expect(reassembleFromLinks(parse(source))).toBe(source);
  });

  it.each([...exampleNames()])("holds for the %s example", (name) => {
    const source = example(name);
    expect(reassembleFromLinks(parse(source))).toBe(source);
  });
});

// --------------------------------------------------------------------------------------------
// Property 2 — span provenance
// --------------------------------------------------------------------------------------------

describe("every span points at the text it claims", () => {
  it("holds across a generated corpus", () => {
    fc.assert(
      fc.property(arbGraph, arbRenderStyle, (graph, style) => {
        const { source } = renderFlow(graph, style);
        expect(checkSpanInvariants(parse(source))).toEqual([]);
      }),
      config,
    );
  });

  it("keeps trivia out of every recorded link span", () => {
    fc.assert(
      fc.property(arbGraph, arbRenderStyle, (graph, style) => {
        const { source } = renderFlow(graph, style);
        const file = parse(source);
        for (const node of file.nodes) {
          const text = sliceSpan(source, node.link.span);
          expect(text.startsWith(".node(")).toBe(true);
          // Comments live between links, never inside one.
          expect(extractComments(text)).toEqual([]);
        }
      }),
      config,
    );
  });
});

// --------------------------------------------------------------------------------------------
// Property 3 — the parse recovers the graph, whatever the formatting
// --------------------------------------------------------------------------------------------

describe("parsing recovers the graph the source was rendered from", () => {
  it("is insensitive to formatting, trivia and option-object style", () => {
    fc.assert(
      fc.property(arbGraph, arbRenderStyle, (graph, style) => {
        const { source, unparsableCount } = renderFlow(graph, style);
        const file = parse(source);
        expect(specOf(file)).toEqual(graph);
        expect(file.unknownLinks).toHaveLength(unparsableCount);
      }),
      config,
    );
  });
});

// --------------------------------------------------------------------------------------------
// Property 4 — the canonical printer round-trips and is idempotent
// --------------------------------------------------------------------------------------------

describe("the canonical printer", () => {
  it("round-trips through the parser", () => {
    fc.assert(
      fc.property(arbGraph, (graph) => {
        expect(specOf(parse(printFlowFile(graph)))).toEqual(graph);
      }),
      config,
    );
  });

  it("is idempotent: printing a parse of its own output changes nothing", () => {
    fc.assert(
      fc.property(arbGraph, (graph) => {
        const once = printFlowFile(graph);
        expect(printFlowFile(specOf(parse(once)))).toBe(once);
      }),
      config,
    );
  });
});

// --------------------------------------------------------------------------------------------
// Property 5 — patch/model commutation. The one the architecture lives or dies on.
// --------------------------------------------------------------------------------------------

describe("parse(patch(src, op)) === applyOp(parse(src), op)", () => {
  it("holds for a single operation on any generated source", () => {
    fc.assert(
      fc.property(arbGraph, arbRenderStyle, arbOpIntent, (graph, style, intent) => {
        const { source } = renderFlow(graph, style);
        const file = parse(source);
        const op = resolveIntent(
          intent,
          specOf(file),
          file.edges.map((e) => e.id),
        );
        if (!op) return;

        const patched = applyPatch(file, [op]).source;
        expect(specOf(parse(patched))).toEqual(applyOpsToSpec(specOf(file), [op]));
      }),
      config,
    );
  });

  it("holds for a sequence of operations applied one at a time, re-parsing between", () => {
    fc.assert(
      fc.property(
        arbGraph,
        arbRenderStyle,
        fc.array(arbOpIntent, { minLength: 1, maxLength: 6 }),
        (graph, style, intents) => {
          let source = renderFlow(graph, style).source;
          let model: FlowGraphSpec = specOf(parse(source));

          for (const intent of intents) {
            const file = parse(source);
            const op = resolveIntent(
              intent,
              specOf(file),
              file.edges.map((e) => e.id),
            );
            if (!op) continue;

            source = applyPatch(file, [op]).source;
            model = applyOpsToSpec(model, [op]);

            // Invariants must hold at *every* step, not just at the end: the editor re-parses
            // after each keystroke, so a span that is briefly wrong is a bug the user sees.
            const reparsed = parse(source);
            expect(checkSpanInvariants(reparsed)).toEqual([]);
            expect(reassembleFromLinks(reparsed)).toBe(source);
            expect(specOf(reparsed)).toEqual(model);
          }
        },
      ),
      config,
    );
  });

  it("holds for a batch of operations applied together", () => {
    // `arbStableGraph`, not `arbGraph`: a batch resolves every op against one snapshot, so it is
    // only well defined when an id means the same thing before and after each op in it. That is
    // a property of the *graph*, and it is the one the canvas maintains. See `batchIsSafe`.
    fc.assert(
      fc.property(
        arbStableGraph,
        arbRenderStyle,
        arbOpIntent,
        arbOpIntent,
        (graph, style, a, b) => {
          const { source } = renderFlow(graph, style);
          const file = parse(source);
          const spec = specOf(file);
          const ids = file.edges.map((e) => e.id);

          // Both ops resolve against the *original* graph, because that is the contract: a batch
          // is computed against one set of source offsets and applied in one go.
          const first = resolveIntent(a, spec, ids);
          const second = resolveIntent(b, spec, ids);
          if (!first || !second) return;

          const ops: FlowOp[] = [first, second];
          if (!batchIsSafe(spec, ops)) return;

          const patched = applyPatch(file, ops).source;
          expect(specOf(parse(patched))).toEqual(applyOpsToSpec(spec, ops));
        },
      ),
      config,
    );
  });
});

/**
 * Whether two ops can legitimately share one batch.
 *
 * A batch is computed against a single snapshot of the source, so:
 *
 * 1. Two ops that would rewrite the *same* span cannot be batched.
 * 2. An op cannot see text that another op in the same batch inserts. `[addEdge("a","a"),
 *    renameNode("a","aa")]` diverges for exactly this reason: the sequential model renames the
 *    endpoints of the new edge, while the patcher computed the rename's spans before the new
 *    edge's text existed. That is inherent to snapshot batching, not a bug to fix, so the rule
 *    is that ops in one batch must be independent — and the extension sends one op per
 *    workspace edit.
 *
 * This works out which source elements each op writes and rejects any batch that breaks
 * either rule.
 *
 * There used to be a third rule here: a batch could not contain two edge-deleting ops when the
 * graph had parallel edges, because positional edge ids renumbered when a sibling went away. It
 * is gone, because edge identity is declared now (docs/spike-findings.md §3.2) and the
 * positional fallback counts only *undeclared* edges, so no edge's identity depends on another
 * edge still existing.
 *
 * It is gone rather than narrowed because the precondition belongs to the graph, not to the pair
 * of ops: a batch needs ids that mean the same thing before and after each op in it, and this
 * property generates graphs that have that — `arbStableGraph`, at most one undeclared edge per
 * pair, which is what the canvas maintains. A hand-written pair with two undeclared parallel
 * edges still renumbers, and `arbGraph` still generates those for every other property.
 */
function batchIsSafe(spec: FlowGraphSpec, ops: readonly FlowOp[]): boolean {
  const ids = edgeIds(spec.edges);
  const existing = new Set(spec.nodes.map((n) => n.id));
  const written = new Set<string>();
  const added = new Set<string>();

  // Rule 2: a node whose identity the batch changes cannot also be the subject of another op in
  // the same batch. The patcher resolves every op against the original spans, so both apply;
  // the sequential model looks the node up by id and the second op silently misses it. Nothing
  // is wrong with either side — the batch is simply not well defined.
  const renamed = new Set(ops.flatMap((op) => (op.op === "renameNode" ? [op.id] : [])));
  const gone = new Set(ops.flatMap((op) => (op.op === "deleteNode" ? [op.id] : [])));
  for (const op of ops) {
    if (op.op === "renameNode") continue;
    if ("id" in op && op.id !== undefined && renamed.has(op.id)) return false;
    if (op.op === "addEdge") {
      for (const end of [op.from, op.to]) {
        if (renamed.has(end) || gone.has(end)) return false;
      }
    }
  }

  for (const op of ops) {
    const keys: string[] = [];

    switch (op.op) {
      case "addNode":
        if (existing.has(op.id) || added.has(op.id)) return false;
        added.add(op.id);
        break;
      case "deleteNode":
        keys.push(`node:${op.id}`, `nodeId:${op.id}`, `nodePos:${op.id}`);
        spec.edges.forEach((edge, i) => {
          if (edge.from === op.id || edge.to === op.id) keys.push(`edge:${ids[i]}`);
        });
        break;
      case "renameNode":
        if (op.newId !== op.id && (existing.has(op.newId) || added.has(op.newId))) return false;
        keys.push(`nodeId:${op.id}`);
        spec.edges.forEach((edge, i) => {
          if (edge.from === op.id) keys.push(`edgeEnd:${ids[i]}:from`, `edge:${ids[i]}`);
          if (edge.to === op.id) keys.push(`edgeEnd:${ids[i]}:to`, `edge:${ids[i]}`);
        });
        break;
      case "moveNode":
        keys.push(`nodePos:${op.id}`);
        break;
      case "addEdge":
        // A pure insertion; several in one batch are fine and come out in op order. An id it
        // declares is an identity it writes, though, so it goes through rule 1 like any other:
        // two ops may not claim the same edge id, and one may not claim an id another deletes.
        if (op.id !== undefined) keys.push(`edge:${op.id}`);
        break;
      case "deleteEdge":
        keys.push(`edge:${op.edgeId}`);
        break;
    }

    for (const key of keys) {
      if (written.has(key)) return false;
      written.add(key);
    }
  }

  return true;
}

// --------------------------------------------------------------------------------------------
// Property 5b — edge identity survives its siblings being deleted
// --------------------------------------------------------------------------------------------

/**
 * The guarantee declared edge ids exist to provide.
 *
 * Before them, an edge was keyed by its position among the edges sharing its endpoints, so
 * deleting one parallel edge renumbered the rest: an id the canvas captured a moment earlier
 * could silently come to mean a different edge. Now a declared id is an edge's identity outright
 * and the positional fallback counts only *undeclared* edges, so no edge's id depends on another
 * edge still being there — provided a pair has at most one undeclared edge, which is what the
 * canvas guarantees (`suggestEdgeId`) and what the generator reproduces.
 */
describe("deleting an edge leaves every other edge's identity alone", () => {
  it("holds when the edge is deleted directly", () => {
    fc.assert(
      fc.property(arbStableGraph, arbRenderStyle, fc.nat({ max: 20 }), (graph, style, which) => {
        const { source } = renderFlow(graph, style);
        const file = parse(source);
        if (file.edges.length === 0) return;

        const target = file.edges[which % file.edges.length]!.id;
        const survivors = file.edges.filter((e) => e.id !== target).map((e) => e.id);

        const patched = applyPatch(file, [{ op: "deleteEdge", edgeId: target }]).source;
        expect(parse(patched).edges.map((e) => e.id)).toEqual(survivors);
      }),
      config,
    );
  });

  it("holds when a node takes several edges down with it", () => {
    fc.assert(
      fc.property(arbStableGraph, arbRenderStyle, fc.nat({ max: 20 }), (graph, style, which) => {
        const { source } = renderFlow(graph, style);
        const file = parse(source);
        if (file.nodes.length === 0) return;

        const target = file.nodes[which % file.nodes.length]!.id;
        const survivors = file.edges
          .filter((e) => e.from !== target && e.to !== target)
          .map((e) => e.id);

        const patched = applyPatch(file, [{ op: "deleteNode", id: target }]).source;
        expect(parse(patched).edges.map((e) => e.id)).toEqual(survivors);
      }),
      config,
    );
  });
});

// --------------------------------------------------------------------------------------------
// Property 6 — the tool never eats a comment
// --------------------------------------------------------------------------------------------

describe("comments survive every patch", () => {
  it("holds for a single operation", () => {
    fc.assert(
      fc.property(arbGraph, arbRenderStyle, arbOpIntent, (graph, style, intent) => {
        const { source } = renderFlow(graph, style);
        const file = parse(source);
        const op = resolveIntent(
          intent,
          specOf(file),
          file.edges.map((e) => e.id),
        );
        if (!op) return;

        const patched = applyPatch(file, [op]).source;
        expect(extractComments(patched)).toEqual(extractComments(source));
      }),
      config,
    );
  });

  it("holds for a sequence of operations", () => {
    fc.assert(
      fc.property(
        arbGraph,
        arbRenderStyle,
        fc.array(arbOpIntent, { minLength: 1, maxLength: 6 }),
        (graph, style, intents) => {
          const original = renderFlow(graph, style).source;
          let source = original;
          for (const intent of intents) {
            const file = parse(source);
            const op = resolveIntent(
              intent,
              specOf(file),
              file.edges.map((e) => e.id),
            );
            if (!op) continue;
            source = applyPatch(file, [op]).source;
          }
          expect(extractComments(source)).toEqual(extractComments(original));
        },
      ),
      config,
    );
  });
});

// --------------------------------------------------------------------------------------------
// Property 7 — node identity: untouched nodes are not destroyed and recreated
// --------------------------------------------------------------------------------------------

describe("untouched nodes keep their source text", () => {
  it("holds for any single operation", () => {
    fc.assert(
      fc.property(arbGraph, arbRenderStyle, arbOpIntent, (graph, style, intent) => {
        const { source } = renderFlow(graph, style);
        const file = parse(source);
        const op = resolveIntent(
          intent,
          specOf(file),
          file.edges.map((e) => e.id),
        );
        if (!op) return;

        const target = targetOf(op);
        const before = new Map(
          file.nodes
            .filter((n) => n.id !== target)
            .map((n) => [n.id, sliceSpan(source, n.link.span)]),
        );

        const patched = applyPatch(file, [op]).source;
        const after = parse(patched);

        for (const node of after.nodes) {
          const text = before.get(node.id);
          if (text === undefined) continue;
          expect(sliceSpan(patched, node.link.span)).toBe(text);
        }
      }),
      config,
    );
  });

  it("leaves links it cannot parse byte-for-byte alone", () => {
    fc.assert(
      fc.property(arbGraph, arbRenderStyle, arbOpIntent, (graph, style, intent) => {
        const { source } = renderFlow(graph, style);
        const file = parse(source);
        if (file.unknownLinks.length === 0) return;
        const op = resolveIntent(
          intent,
          specOf(file),
          file.edges.map((e) => e.id),
        );
        if (!op) return;

        const before = file.unknownLinks.map((u) => sliceSpan(source, u.link.span));
        const patched = applyPatch(file, [op]).source;
        for (const text of before) expect(patched).toContain(text);
      }),
      config,
    );
  });
});

function targetOf(op: FlowOp): string | undefined {
  switch (op.op) {
    case "addNode":
    case "deleteNode":
    case "renameNode":
    case "moveNode":
      return op.id;
    default:
      return undefined;
  }
}

// --------------------------------------------------------------------------------------------
// Property 8 — a patch is always a small, local edit
// --------------------------------------------------------------------------------------------

describe("a patch is never a whole-file rewrite", () => {
  it("touches a bounded number of bytes, independent of file size", () => {
    fc.assert(
      fc.property(arbGraph, arbRenderStyle, arbOpIntent, (graph, style, intent) => {
        const { source } = renderFlow(graph, style);
        const file = parse(source);
        const op = resolveIntent(
          intent,
          specOf(file),
          file.edges.map((e) => e.id),
        );
        if (!op) return;

        const { edits } = applyPatch(file, [op]);
        // A delete of a node with every edge incident to it is the widest case: one link per
        // element, and a link's text is bounded by how it was written, not by the file.
        const touched = edits.reduce((sum, e) => sum + (e.range.end - e.range.start), 0);
        const chainLength = (file.chainSpan?.end ?? 0) - (file.chainSpan?.start ?? 0);
        expect(touched).toBeLessThanOrEqual(chainLength);
        for (const edit of edits) {
          expect(edit.range.start).toBeGreaterThanOrEqual(0);
          expect(edit.range.end).toBeLessThanOrEqual(source.length);
        }
      }),
      config,
    );
  });
});
