import { beforeAll, describe, expect, it } from "vitest";
import { type FlowFile, getParser, parseFlowSourceWith, sliceSpan, specOf } from "../src/index.js";
import { example, exampleNames, fixture, fixtureNames } from "./helpers.js";

let parse: (source: string) => FlowFile;

beforeAll(async () => {
  const parser = await getParser();
  parse = (source) => parseFlowSourceWith(parser, source);
});

describe("parsing the canonical shape", () => {
  it("reads the name, nodes, edges and positions", () => {
    const file = parse(fixture("canonical.flow.ts"));

    expect(file.diagnostics).toEqual([]);
    expect(specOf(file)).toEqual({
      name: "canonical",
      nodes: [
        { id: "a", kind: "source", position: { x: 0, y: 0 } },
        { id: "b", kind: "transform", position: { x: 240, y: 0 } },
        { id: "c", kind: "sink", position: { x: 480, y: 0 } },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
  });

  it("gives every node and edge a span that points at its own source text", () => {
    const src = fixture("canonical.flow.ts");
    const file = parse(src);

    expect(sliceSpan(src, file.nodes[1]!.idSpan)).toBe("b");
    expect(sliceSpan(src, file.nodes[1]!.positionSpan!)).toBe("[240, 0]");
    expect(sliceSpan(src, file.nodes[1]!.link.span)).toBe(
      '.node("b", { kind: "transform", at: [240, 0] })',
    );
    expect(sliceSpan(src, file.edges[0]!.link.span)).toBe('.edge("a", "b")');
    expect(sliceSpan(src, file.nameSpan!)).toBe("canonical");
  });
});

describe("hostile formatting", () => {
  it("reads nodes through tabs, over-indentation and trailing commas", () => {
    const file = parse(fixture("hostile-whitespace.flow.ts"));

    expect(file.name).toBe("ugly");
    expect(specOf(file).nodes).toEqual([
      { id: "tabbed", kind: "source", position: { x: 0, y: 0 } },
      { id: "overIndented", kind: "transform", position: { x: 240, y: 0 } },
      { id: "trailingCommas", kind: "sink", position: { x: 480, y: 0 } },
    ]);
    expect(specOf(file).edges).toEqual([
      { from: "tabbed", to: "overIndented" },
      { from: "overIndented", to: "trailingCommas", label: "rows" },
    ]);
    expect(file.unknownLinks).toEqual([]);
  });

  it("keeps comments outside every recorded span", () => {
    const src = fixture("comments-between-nodes.flow.ts");
    const file = parse(src);

    expect(specOf(file).nodes.map((n) => n.id)).toEqual(["ingest", "clean", "store"]);
    for (const node of file.nodes) {
      expect(sliceSpan(src, node.link.span)).not.toContain("//");
      expect(sliceSpan(src, node.link.span)).not.toContain("/*");
    }
  });
});

describe("links the parser refuses to understand", () => {
  it("records them with a reason and still reads the valid ones beside them", () => {
    const file = parse(fixture("unparsable-beside-valid.flow.ts"));

    expect(specOf(file).nodes.map((n) => n.id)).toEqual(["valid1", "valid2", "valid3"]);
    expect(file.unknownLinks.map((u) => u.reason).sort()).toEqual([
      "non-literal-id",
      "non-literal-id",
      "non-literal-id",
      "unknown-method",
    ]);
    expect(file.diagnostics.every((d) => d.code === "unparsable-link")).toBe(true);
  });

  it("still parses a half-typed file and reports the syntax error", () => {
    const file = parse(fixture("syntax-error.flow.ts"));

    // tree-sitter is error-tolerant, which is why the canvas can stay open while typing.
    expect(specOf(file).nodes.map((n) => n.id)).toContain("done");
    expect(file.diagnostics.some((d) => d.code === "syntax-error")).toBe(true);
  });
});

describe("opaque payload", () => {
  it("records only the keys the canvas owns and ignores the rest", () => {
    const file = parse(fixture("opaque-payload.flow.ts"));

    expect(specOf(file).nodes).toEqual([
      { id: "read", kind: "source", position: { x: 0, y: 0 } },
      { id: "tidy", kind: "transform", position: { x: 240, y: 0 } },
      { id: "noOptions" },
      { id: "emptyOptions" },
      { id: "noPosition", kind: "sink" },
    ]);
    expect(file.unknownLinks).toEqual([]);
  });

  it("distinguishes no-options, empty-options and no-position nodes", () => {
    const file = parse(fixture("opaque-payload.flow.ts"));
    const byId = new Map(file.nodes.map((n) => [n.id, n]));

    expect(byId.get("noOptions")!.optionsSpan).toBeUndefined();
    expect(byId.get("emptyOptions")!.optionsSpan).toBeDefined();
    expect(byId.get("emptyOptions")!.positionSpan).toBeUndefined();
    expect(byId.get("noPosition")!.optionsSpan).toBeDefined();
    expect(byId.get("noPosition")!.positionSpan).toBeUndefined();
  });
});

describe("node descriptions", () => {
  const SRC = [
    'import { flow } from "@twowayflow/dsl";',
    "",
    'export default flow("described")',
    '  .node("plain", { kind: "source", at: [0, 0] })',
    '  .node("told", {',
    '    kind: "transform",',
    "    at: [240, 0],",
    '    label: "tidy",',
    '    description: "Drops rows the schema cannot explain, and says so in the log.",',
    "    params: { strict: true },",
    "  })",
    '  .node("accented", { description: "mesure de débit — 100% / 2" })',
    '  .node("computed", { description: "half " + "a description" })',
    '  .edge("plain", "told");',
    "",
  ].join("\n");

  it("reads a description the way it reads a label", () => {
    const file = parse(SRC);

    expect(file.diagnostics).toEqual([]);
    const byId = new Map(specOf(file).nodes.map((n) => [n.id, n]));
    expect(byId.get("told")!.description).toBe(
      "Drops rows the schema cannot explain, and says so in the log.",
    );
    expect(byId.get("accented")!.description).toBe("mesure de débit — 100% / 2");
  });

  it("leaves a node without one undescribed rather than inventing a fallback", () => {
    const byId = new Map(specOf(parse(SRC)).nodes.map((n) => [n.id, n]));
    expect(byId.get("plain")!.description).toBeUndefined();
  });

  it("ignores a description the patcher could not rewrite, and still reads the node", () => {
    const byId = new Map(specOf(parse(SRC)).nodes.map((n) => [n.id, n]));
    expect(byId.get("computed")).toBeDefined();
    expect(byId.get("computed")!.description).toBeUndefined();
    expect(parse(SRC).unknownLinks).toEqual([]);
  });

  it("reads the descriptions carried by the pessoa-rag example", () => {
    const nodes = specOf(parse(example("pessoa-rag.flow.ts"))).nodes;

    expect(nodes.every((n) => n.description !== undefined && n.description.length > 0)).toBe(true);
    expect(nodes.find((n) => n.id === "fundirRrf")!.description).toContain("reciprocal rank");
  });
});

describe("declared edge ids", () => {
  const SRC = [
    'import { flow } from "@twowayflow/dsl";',
    "",
    'export default flow("f")',
    '  .node("a", { kind: "source" })',
    '  .node("b", { kind: "sink" })',
    '  .edge("a", "b")',
    '  .edge("a", "b", { id: "fast-path", label: "cached" });',
    "",
  ].join("\n");

  it("uses the declared id as the edge's identity and records its span", () => {
    const file = parse(SRC);

    expect(file.edges.map((e) => e.id)).toEqual(["a->b", "fast-path"]);
    expect(file.edges[1]!.declaredId).toBe("fast-path");
    expect(sliceSpan(SRC, file.edges[1]!.idSpan!)).toBe("fast-path");
    expect(file.diagnostics).toEqual([]);
  });

  it("reports the declared id in the spec, and only the declared one", () => {
    expect(specOf(parse(SRC)).edges).toEqual([
      { from: "a", to: "b" },
      { from: "a", to: "b", id: "fast-path", label: "cached" },
    ]);
  });

  it("does not renumber undeclared siblings — positional ids count only undeclared edges", () => {
    const file = parse(fixture("parallel-edges.flow.ts"));

    // The declared ids do not consume `#1` and `#2`: the undeclared edge keeps the bare pair.
    expect(file.edges.map((e) => e.id)).toEqual(["fanIn->merge", "fast-path", "slow-path"]);
    expect(file.diagnostics).toEqual([]);
  });

  it("refuses a link whose id is computed rather than written", () => {
    const src = SRC.replace('{ id: "fast-path", label: "cached" }', "{ id: someVar }");
    const file = parse(src);

    // The other edge is unaffected: one opaque link never takes its siblings down with it.
    expect(file.edges.map((e) => e.id)).toEqual(["a->b"]);
    expect(file.unknownLinks.map((u) => u.reason)).toEqual(["non-literal-id"]);
  });

  it("reports two edges that resolve to the same id", () => {
    const src = SRC.replace('.edge("a", "b")\n', '.edge("a", "b", { id: "fast-path" })\n');
    const file = parse(src);

    expect(file.diagnostics.map((d) => d.code)).toEqual(["duplicate-edge-id"]);
    expect(file.edges.map((e) => e.id)).toEqual(["fast-path", "fast-path"]);
  });
});

describe("the shipped examples", () => {
  it.each(exampleNames())("%s parses with no diagnostics", (name) => {
    const file = parse(example(name));
    expect(file.diagnostics).toEqual([]);
    expect(file.nodes.length).toBeGreaterThan(0);
  });
});

describe("files that are not flows", () => {
  it("reports no-flow-chain rather than throwing", () => {
    const file = parse("export const x = 1;\n");
    expect(file.diagnostics.map((d) => d.code)).toEqual(["no-flow-chain"]);
    expect(file.nodes).toEqual([]);
  });
});

describe("every fixture", () => {
  it.each(fixtureNames())("%s parses without throwing", (name) => {
    expect(() => parse(fixture(name))).not.toThrow();
  });
});
