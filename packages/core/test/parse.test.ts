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
