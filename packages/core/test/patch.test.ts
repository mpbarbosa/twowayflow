import { beforeAll, describe, expect, it } from "vitest";
import {
  applyEdits,
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
