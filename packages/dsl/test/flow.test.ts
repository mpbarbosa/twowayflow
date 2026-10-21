import { describe, expect, it } from "vitest";
import { flow } from "../src/index.js";

describe("flow builder", () => {
  it("materialises nodes and edges in declaration order", () => {
    const spec = flow("demo")
      .node("a", { kind: "source", at: [0, 0] })
      .node("b", { kind: "sink", at: [240, 0], label: "write" })
      .edge("a", "b", { label: "rows" })
      .toSpec();

    expect(spec).toEqual({
      name: "demo",
      nodes: [
        { id: "a", kind: "source", position: { x: 0, y: 0 }, options: {} },
        { id: "b", kind: "sink", label: "write", position: { x: 240, y: 0 }, options: {} },
      ],
      edges: [{ from: "a", to: "b", label: "rows" }],
    });
  });

  it("keeps unrecognised options as opaque payload", () => {
    const run = (rows: number[]) => rows.map(Number);
    const spec = flow("demo")
      .node("a", { kind: "transform", params: { path: "./in.csv" }, run })
      .toSpec();

    expect(spec.nodes[0]?.options).toEqual({ params: { path: "./in.csv" }, run });
  });

  it("is immutable — a builder can be branched", () => {
    const base = flow("demo").node("a", { kind: "source" });
    const left = base.node("l", { kind: "sink" }).toSpec();
    const right = base.node("r", { kind: "sink" }).toSpec();

    expect(left.nodes.map((n) => n.id)).toEqual(["a", "l"]);
    expect(right.nodes.map((n) => n.id)).toEqual(["a", "r"]);
  });

  it("omits position when `at` is absent", () => {
    const spec = flow("demo").node("a", { kind: "source" }).toSpec();
    expect(spec.nodes[0]).not.toHaveProperty("position");
  });
});
