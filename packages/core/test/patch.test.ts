import { beforeAll, describe, expect, it } from "vitest";
import {
  applyEdits,
  applyOpsToSpec,
  applyPatch,
  checkSpanInvariants,
  extractComments,
  type FlowFile,
  type FlowOp,
  getParser,
  PatchError,
  parseFlowSourceWith,
  patch,
  sliceSpan,
  specOf,
  suggestEdgeId,
} from "../src/index.js";
import { fixture } from "./helpers.js";

let parse: (source: string) => FlowFile;

beforeAll(async () => {
  const parser = await getParser();
  parse = (source) => parseFlowSourceWith(parser, source);
});

function run(source: string, ops: FlowOp[]): string {
  return applyPatch(parse(source), ops).source;
}

const CANON = [
  'import { flow } from "@twowayflow/dsl";',
  "",
  'export default flow("canonical")',
  '  .node("a", { kind: "source", at: [0, 0] })',
  '  .node("b", { kind: "transform", at: [240, 0] })',
  '  .node("c", { kind: "sink", at: [480, 0] })',
  '  .edge("a", "b")',
  '  .edge("b", "c");',
  "",
].join("\n");

describe("every operation produces only ranged edits", () => {
  it("never emits an edit covering the whole file", () => {
    const file = parse(CANON);
    const ops: FlowOp[] = [
      { op: "addNode", id: "d", kind: "sink", position: { x: 720, y: 0 } },
      { op: "moveNode", id: "b", position: { x: 1, y: 2 } },
      { op: "renameNode", id: "c", newId: "sink1" },
      { op: "addEdge", from: "a", to: "c" },
    ];
    for (const op of ops) {
      const { edits } = patch(file, [op]);
      expect(edits.length).toBeGreaterThan(0);
      for (const edit of edits) {
        const covered = edit.range.end - edit.range.start;
        expect(covered).toBeLessThan(CANON.length / 2);
      }
    }
  });
});

describe("moveNode", () => {
  it("replaces exactly the `at` array literal", () => {
    const file = parse(CANON);
    const { edits } = patch(file, [{ op: "moveNode", id: "b", position: { x: 300, y: 96 } }]);

    expect(edits).toHaveLength(1);
    expect(sliceSpan(CANON, edits[0]!.range)).toBe("[240, 0]");
    expect(edits[0]!.newText).toBe("[300, 96]");
    expect(applyEdits(CANON, edits)).toContain('.node("b", { kind: "transform", at: [300, 96] })');
  });

  it("leaves a closure sitting beside `at` byte-for-byte alone", () => {
    const src = fixture("opaque-payload.flow.ts");
    const out = run(src, [{ op: "moveNode", id: "tidy", position: { x: 999, y: -40 } }]);

    const closure = src.slice(src.indexOf("run: ("), src.indexOf("retries: 3"));
    expect(out).toContain(closure);
    expect(out).toContain("at: [999, -40]");
    expect(specOf(parse(out)).nodes.find((n) => n.id === "tidy")?.position).toEqual({
      x: 999,
      y: -40,
    });
  });

  it("inserts `at` into an options object that does not have one", () => {
    const src = fixture("opaque-payload.flow.ts");
    const out = run(src, [{ op: "moveNode", id: "noPosition", position: { x: 10, y: 20 } }]);

    expect(out).toContain('.node("noPosition", { at: [10, 20], kind: "sink" })');
  });

  it("replaces an empty options object wholesale", () => {
    const src = fixture("opaque-payload.flow.ts");
    const out = run(src, [{ op: "moveNode", id: "emptyOptions", position: { x: 10, y: 20 } }]);

    expect(out).toContain('.node("emptyOptions", { at: [10, 20] })');
  });

  it("appends an options object to a node that has none", () => {
    const src = fixture("opaque-payload.flow.ts");
    const out = run(src, [{ op: "moveNode", id: "noOptions", position: { x: 10, y: 20 } }]);

    expect(out).toContain('.node("noOptions", { at: [10, 20] })');
  });

  it("handles the hostile-whitespace file without reformatting it", () => {
    const src = fixture("hostile-whitespace.flow.ts");
    const out = run(src, [{ op: "moveNode", id: "overIndented", position: { x: 1, y: 2 } }]);

    // The over-indented multi-line options object keeps its shape; only the array changed.
    expect(out).toContain('            kind:      "transform",');
    expect(out).toContain("[1, 2]");
    expect(out.replace("[1, 2]", "[ 240 , 0 ]")).toBe(src);
  });
});

describe("addNode", () => {
  it("is a pure insertion after the last node link", () => {
    const file = parse(CANON);
    const { edits } = patch(file, [
      { op: "addNode", id: "d", kind: "filter", position: { x: 720, y: 0 } },
    ]);

    expect(edits).toHaveLength(1);
    expect(edits[0]!.range.start).toBe(edits[0]!.range.end);
    expect(edits[0]!.newText).toBe('\n  .node("d", { kind: "filter", at: [720, 0] })');
    expect(applyEdits(CANON, edits)).toBe(
      CANON.replace(
        '  .node("c", { kind: "sink", at: [480, 0] })\n',
        '  .node("c", { kind: "sink", at: [480, 0] })\n  .node("d", { kind: "filter", at: [720, 0] })\n',
      ),
    );
  });

  it("goes after a trailing comment rather than underneath it", () => {
    const src = [
      'import { flow } from "@twowayflow/dsl";',
      "",
      'export default flow("f")',
      '  .node("a", { kind: "source" }) // keep me on this line',
      '  .edge("a", "a");',
      "",
    ].join("\n");
    const out = run(src, [{ op: "addNode", id: "b", kind: "sink" }]);

    expect(out).toContain('.node("a", { kind: "source" }) // keep me on this line\n  .node("b"');
  });

  it("appends inline when the whole chain is on one line", () => {
    const src = 'import { flow } from "@twowayflow/dsl";\nexport default flow("f").node("a");\n';
    const out = run(src, [{ op: "addNode", id: "b", kind: "sink" }]);

    expect(out).toBe(
      'import { flow } from "@twowayflow/dsl";\n' +
        'export default flow("f").node("a").node("b", { kind: "sink" });\n',
    );
  });

  it("starts a chain on an empty flow", () => {
    const src = 'import { flow } from "@twowayflow/dsl";\nexport default flow("f");\n';
    const out = run(src, [{ op: "addNode", id: "a", kind: "source", position: { x: 0, y: 0 } }]);

    expect(out).toBe(
      'import { flow } from "@twowayflow/dsl";\n' +
        'export default flow("f")\n  .node("a", { kind: "source", at: [0, 0] });\n',
    );
  });

  it("refuses a duplicate id", () => {
    expect(() => run(CANON, [{ op: "addNode", id: "a" }])).toThrow(PatchError);
  });
});

describe("addEdge", () => {
  it("is a pure insertion after the last edge link", () => {
    const out = run(CANON, [{ op: "addEdge", from: "a", to: "c", label: "skip" }]);
    expect(out).toBe(
      CANON.replace('.edge("b", "c");', '.edge("b", "c")\n  .edge("a", "c", { label: "skip" });'),
    );
  });

  it("goes after the last node when there are no edges yet", () => {
    const src = [
      'import { flow } from "@twowayflow/dsl";',
      "",
      'export default flow("f")',
      '  .node("a", { kind: "source" })',
      '  .node("b", { kind: "sink" });',
      "",
    ].join("\n");
    const out = run(src, [{ op: "addEdge", from: "a", to: "b" }]);

    expect(out).toContain('.node("b", { kind: "sink" })\n  .edge("a", "b");');
  });

  it("warns about an endpoint that is not declared, but still writes the edge", () => {
    const { source, warnings } = applyPatch(parse(CANON), [
      { op: "addEdge", from: "a", to: "nope" },
    ]);
    expect(source).toContain('.edge("a", "nope")');
    expect(warnings.map((w) => w.code)).toEqual(["dangling-edge"]);
  });
});

describe("renameNode", () => {
  it("rewrites the declaration and every reference, and nothing else", () => {
    const file = parse(CANON);
    const { edits } = patch(file, [{ op: "renameNode", id: "b", newId: "bbb" }]);

    expect(edits).toHaveLength(3);
    for (const edit of edits) expect(sliceSpan(CANON, edit.range)).toBe("b");
    expect(applyEdits(CANON, edits)).toBe(
      CANON.replace('.node("b"', '.node("bbb"')
        .replace('.edge("a", "b")', '.edge("a", "bbb")')
        .replace('.edge("b", "c")', '.edge("bbb", "c")'),
    );
  });

  it("warns that unparsable links may still reference the old id", () => {
    const { warnings } = applyPatch(parse(fixture("unparsable-beside-valid.flow.ts")), [
      { op: "renameNode", id: "valid2", newId: "renamed" },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("cannot read");
  });

  it("refuses an id that cannot be written as a plain literal", () => {
    expect(() => run(CANON, [{ op: "renameNode", id: "a", newId: 'has"quote' }])).toThrow(
      PatchError,
    );
  });
});

describe("deleteNode", () => {
  it("removes the link, its leading whitespace and its incident edges", () => {
    const out = run(CANON, [{ op: "deleteNode", id: "b" }]);
    expect(out).toBe(
      [
        'import { flow } from "@twowayflow/dsl";',
        "",
        'export default flow("canonical")',
        '  .node("a", { kind: "source", at: [0, 0] })',
        '  .node("c", { kind: "sink", at: [480, 0] });',
        "",
      ].join("\n"),
    );
  });

  it("does not eat a comment that sits between two links", () => {
    const src = fixture("comments-between-nodes.flow.ts");
    const out = run(src, [{ op: "deleteNode", id: "clean" }]);

    expect(extractComments(out)).toEqual(extractComments(src));
    expect(specOf(parse(out)).nodes.map((n) => n.id)).toEqual(["ingest", "store"]);
    expect(specOf(parse(out)).edges).toEqual([]);
  });

  it("does not leave the rest of the chain stranded on a comment line", () => {
    const src = [
      'import { flow } from "@twowayflow/dsl";',
      "",
      'export default flow("f")',
      '  .node("a", { kind: "source" })',
      "  // a note about b",
      '  .node("b", { kind: "sink" });',
      "",
    ].join("\n");
    const out = run(src, [{ op: "deleteNode", id: "b" }]);

    expect(out).toContain("// a note about b\n  ;");
    expect(parse(out).diagnostics.filter((d) => d.code === "syntax-error")).toEqual([]);
    expect(specOf(parse(out)).nodes.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("deleteEdge", () => {
  it("removes exactly one edge link", () => {
    const out = run(CANON, [{ op: "deleteEdge", edgeId: "a->b" }]);
    expect(out).toBe(CANON.replace('  .edge("a", "b")\n', ""));
  });

  it("distinguishes duplicate edges by their suffixed ids", () => {
    const src = [
      'import { flow } from "@twowayflow/dsl";',
      "",
      'export default flow("f")',
      '  .node("a", { kind: "source" })',
      '  .node("b", { kind: "sink" })',
      '  .edge("a", "b", { label: "first" })',
      '  .edge("a", "b", { label: "second" });',
      "",
    ].join("\n");

    expect(parse(src).edges.map((e) => e.id)).toEqual(["a->b", "a->b#1"]);
    expect(run(src, [{ op: "deleteEdge", edgeId: "a->b#1" }])).not.toContain("second");
    expect(run(src, [{ op: "deleteEdge", edgeId: "a->b" }])).not.toContain("first");
  });

  it("still renumbers undeclared siblings, which is why the canvas declares ids", () => {
    // The one case declared ids do not rescue: a hand-written pair where *neither* edge names
    // itself. Deleting the first leaves the second answering to a different id than it did a
    // moment ago. Nothing the canvas writes looks like this — `suggestEdgeId` declares an id for
    // every parallel edge it creates — but a person can type it, so it is written down here
    // rather than discovered later. See docs/spike-findings.md §3.2.
    const src = [
      'import { flow } from "@twowayflow/dsl";',
      "",
      'export default flow("f")',
      '  .node("a", { kind: "source" })',
      '  .node("b", { kind: "sink" })',
      '  .edge("a", "b", { label: "first" })',
      '  .edge("a", "b", { label: "second" });',
      "",
    ].join("\n");

    const out = run(src, [{ op: "deleteEdge", edgeId: "a->b" }]);
    const after = parse(out);

    expect(after.edges.map((e) => e.label)).toEqual(["second"]);
    expect(after.edges.map((e) => e.id)).toEqual(["a->b"]);
  });
});

describe("declared edge ids", () => {
  const PARALLEL = fixture("parallel-edges.flow.ts");

  it("suggests nothing for the first edge of a pair and an id for every later one", () => {
    const edges = specOf(parse(CANON)).edges;

    expect(suggestEdgeId(edges, "a", "c")).toBeUndefined();
    expect(suggestEdgeId(edges, "a", "b")).toBe("a->b#1");
    expect(suggestEdgeId(specOf(parse(PARALLEL)).edges, "fanIn", "merge")).toBe("fanIn->merge#1");
  });

  it("writes the id into the new link when addEdge is given one", () => {
    const out = run(CANON, [{ op: "addEdge", from: "a", to: "b", id: "a->b#1" }]);

    expect(out).toContain('.edge("a", "b", { id: "a->b#1" })');
    expect(parse(out).edges.map((e) => e.id)).toEqual(["a->b", "b->c", "a->b#1"]);
  });

  it("refuses an id that already identifies an edge", () => {
    expect(() => run(CANON, [{ op: "addEdge", from: "a", to: "b", id: "a->b" }])).toThrow(
      PatchError,
    );
  });

  it("deletes one of several parallel edges and leaves its siblings' identity alone", () => {
    const before = parse(PARALLEL);
    expect(before.edges.map((e) => e.id)).toEqual(["fanIn->merge", "fast-path", "slow-path"]);

    // Delete the *first* of the three. Under positional identity this was the dangerous case:
    // the siblings would shuffle down into `fanIn->merge` and `fanIn->merge#1`, so an id read a
    // moment earlier would now name a different edge.
    const out = run(PARALLEL, [{ op: "deleteEdge", edgeId: "fanIn->merge" }]);
    const after = parse(out);

    expect(after.edges.map((e) => e.id)).toEqual(["fast-path", "slow-path"]);
    expect(after.edges.map((e) => e.label)).toEqual(["cached", "recomputed"]);
    // Byte-for-byte: the surviving links were not reprinted, only the deleted one removed.
    for (const edge of before.edges.slice(1)) {
      expect(out).toContain(sliceSpan(PARALLEL, edge.link.span));
    }
  });

  it("deletes two parallel edges in one batch, which positional identity could not express", () => {
    const file = parse(PARALLEL);
    const ops: FlowOp[] = [
      { op: "deleteEdge", edgeId: "fanIn->merge" },
      { op: "deleteEdge", edgeId: "slow-path" },
    ];

    const out = applyPatch(file, ops).source;
    expect(specOf(parse(out))).toEqual(applyOpsToSpec(specOf(file), ops));
    expect(parse(out).edges.map((e) => e.id)).toEqual(["fast-path"]);
  });

  it("keeps a declared id across a rename of both its endpoints", () => {
    let source = PARALLEL;
    for (const op of [
      { op: "renameNode", id: "fanIn", newId: "split" },
      { op: "renameNode", id: "merge", newId: "collect" },
    ] satisfies FlowOp[]) {
      source = run(source, [op]);
    }

    // The positional edge followed its endpoints, as it must. The declared ones did not move.
    expect(parse(source).edges.map((e) => e.id)).toEqual([
      "split->collect",
      "fast-path",
      "slow-path",
    ]);
  });

  it("refuses to delete an edge whose id is ambiguous", () => {
    const src = PARALLEL.replace('{ id: "slow-path"', '{ id: "fast-path"');
    expect(parse(src).diagnostics.map((d) => d.code)).toEqual(["duplicate-edge-id"]);
    expect(() => run(src, [{ op: "deleteEdge", edgeId: "fast-path" }])).toThrow(PatchError);
  });
});

describe("unparsable links", () => {
  it("come out of a patch byte-for-byte unchanged", () => {
    const src = fixture("unparsable-beside-valid.flow.ts");
    const file = parse(src);
    const before = file.unknownLinks.map((u) => sliceSpan(src, u.link.span));
    expect(before).toHaveLength(4);

    const out = applyPatch(file, [
      { op: "moveNode", id: "valid1", position: { x: 5, y: 5 } },
      { op: "addNode", id: "fresh", kind: "sink", position: { x: 0, y: 400 } },
      { op: "addEdge", from: "valid3", to: "fresh" },
      { op: "deleteEdge", edgeId: "valid1->valid2" },
    ]).source;

    for (const text of before) expect(out).toContain(text);
    expect(extractComments(out)).toEqual(extractComments(src));
  });
});

describe("re-parsing after a patch", () => {
  it("preserves the span text of every untouched node", () => {
    const src = CANON;
    const file = parse(src);
    const untouchedBefore = file.nodes
      .filter((n) => n.id !== "b")
      .map((n) => sliceSpan(src, n.link.span));

    const out = applyPatch(file, [{ op: "moveNode", id: "b", position: { x: 7, y: 7 } }]).source;
    const after = parse(out);
    const untouchedAfter = after.nodes
      .filter((n) => n.id !== "b")
      .map((n) => sliceSpan(out, n.link.span));

    expect(untouchedAfter).toEqual(untouchedBefore);
    expect(checkSpanInvariants(after)).toEqual([]);
  });

  it("keeps spans valid after a whole sequence of operations", () => {
    let source = CANON;
    const sequence: FlowOp[][] = [
      [{ op: "addNode", id: "d", kind: "filter", position: { x: 720, y: 0 } }],
      [{ op: "addEdge", from: "c", to: "d" }],
      [{ op: "moveNode", id: "d", position: { x: 760, y: 40 } }],
      [{ op: "renameNode", id: "d", newId: "dee" }],
      [{ op: "deleteNode", id: "b" }],
    ];
    for (const ops of sequence) {
      source = applyPatch(parse(source), ops).source;
      expect(checkSpanInvariants(parse(source))).toEqual([]);
    }

    expect(specOf(parse(source))).toEqual({
      name: "canonical",
      nodes: [
        { id: "a", kind: "source", position: { x: 0, y: 0 } },
        { id: "c", kind: "sink", position: { x: 480, y: 0 } },
        { id: "dee", kind: "filter", position: { x: 760, y: 40 } },
      ],
      edges: [{ from: "c", to: "dee" }],
    });
  });
});

describe("conflicting batches", () => {
  it("refuses to operate on a node deleted earlier in the same batch", () => {
    expect(() =>
      patch(parse(CANON), [
        { op: "deleteNode", id: "b" },
        { op: "moveNode", id: "b", position: { x: 1, y: 1 } },
      ]),
    ).toThrow(PatchError);
  });
});

describe("batched deletes of parallel edges", () => {
  // Regression. An undeclared edge is identified positionally, so removing one sibling
  // renumbers the rest. `patch()` resolves every op against one snapshot and deletes both
  // links; `applyOpsToSpec` used to recompute ids after each op, so the second delete found no
  // `a->b#1` and silently kept that edge. The two then disagreed about what one batch meant.
  //
  // The guard that used to exclude this case from the property suite was removed when declared
  // edge ids landed, without the underlying case being fixed. These tests pin it so it cannot
  // be dropped silently again.
  const PARALLEL = [
    'import { flow } from "@twowayflow/dsl";',
    "",
    'export default flow("parallel")',
    '  .node("a", { kind: "source" })',
    '  .node("b", { kind: "sink" })',
    '  .edge("a", "b")',
    '  .edge("a", "b");',
    "",
  ].join("\n");

  it("identifies undeclared parallel edges positionally", () => {
    expect(parse(PARALLEL).edges.map((e) => e.id)).toEqual(["a->b", "a->b#1"]);
  });

  it("deletes both when one batch names both, and agrees with the model", () => {
    const file = parse(PARALLEL);
    const ops: FlowOp[] = [
      { op: "deleteEdge", edgeId: "a->b" },
      { op: "deleteEdge", edgeId: "a->b#1" },
    ];

    const patched = applyPatch(file, ops).source;
    expect(specOf(parse(patched)).edges).toEqual([]);
    expect(specOf(parse(patched))).toEqual(applyOpsToSpec(specOf(file), ops));
  });

  it("deletes only the named one when a batch names one of two", () => {
    const file = parse(PARALLEL);
    const ops: FlowOp[] = [{ op: "deleteEdge", edgeId: "a->b#1" }];

    const patched = applyPatch(file, ops).source;
    expect(specOf(parse(patched)).edges).toEqual([{ from: "a", to: "b" }]);
    expect(specOf(parse(patched))).toEqual(applyOpsToSpec(specOf(file), ops));
  });

  it("agrees for declared ids too, where identity never shifts", () => {
    const src = PARALLEL.replace(
      '  .edge("a", "b")\n  .edge("a", "b");',
      '  .edge("a", "b", { id: "one" })\n  .edge("a", "b", { id: "two" });',
    );
    const file = parse(src);
    expect(file.edges.map((e) => e.id)).toEqual(["one", "two"]);

    const ops: FlowOp[] = [
      { op: "deleteEdge", edgeId: "one" },
      { op: "deleteEdge", edgeId: "two" },
    ];
    const patched = applyPatch(file, ops).source;
    expect(specOf(parse(patched)).edges).toEqual([]);
    expect(specOf(parse(patched))).toEqual(applyOpsToSpec(specOf(file), ops));
  });

  it("takes incident parallel edges with the node, by endpoint rather than by id", () => {
    const file = parse(PARALLEL);
    const ops: FlowOp[] = [{ op: "deleteNode", id: "a" }];

    const patched = applyPatch(file, ops).source;
    expect(specOf(parse(patched)).edges).toEqual([]);
    expect(specOf(parse(patched))).toEqual(applyOpsToSpec(specOf(file), ops));
  });
});
