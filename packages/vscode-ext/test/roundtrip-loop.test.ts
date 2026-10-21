/**
 * The design -> code -> design loop, driven through the extension host with the VS Code API
 * stubbed out.
 *
 * `packages/core` proves the patcher is correct. This proves the *wiring* is correct: that a
 * canvas gesture becomes ranged `WorkspaceEdit` replacements, that applying them changes the
 * document, and that the resulting document change re-parses and pushes a new graph back —
 * with no "Sync" step anywhere in the chain.
 */
import { fileURLToPath } from "node:url";
import { extractComments } from "@twowayflow/core";
import { beforeEach, describe, expect, it } from "vitest";
import { harness, Uri } from "./vscode-stub.js";

const { FlowPanel } = await import("../src/panel.js");

// The real package directory, so the test loads the same WASM files the extension ships. When
// `dist/` has not been built the extension falls back to node_modules, which is what makes
// `pnpm install && pnpm test` work from a clean clone.
const EXTENSION_URI = Uri.file(fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, ""));

const SOURCE = [
  'import { flow } from "@twowayflow/dsl";',
  "",
  "// A note that must survive the whole session.",
  'export default flow("loop")',
  '  .node("read", { kind: "source", at: [0, 0] })',
  "  // the expensive step",
  '  .node("work", { kind: "transform", at: [240, 0], retries: 3 })',
  '  .node("write", { kind: "sink", at: [480, 0] })',
  '  .edge("read", "work")',
  '  .edge("work", "write");',
  "",
].join("\n");

async function openPanel(source = SOURCE) {
  harness.reset(source);
  // `FlowPanel.open` takes a vscode.TextDocument; the stub implements the slice it uses.
  await FlowPanel.open(harness.document as never, EXTENSION_URI as never);
  await harness.fromWebview({ type: "ready" });
}

beforeEach(() => {
  harness.reset(SOURCE);
});

describe("design -> code", () => {
  it("turns a drag into ranged edits, not a file rewrite", async () => {
    await openPanel();

    await harness.fromWebview({
      type: "moveNode",
      nodeId: "work",
      position: { x: 300, y: 128 },
    });

    expect(harness.appliedEdits).toHaveLength(1);
    const edits = harness.appliedEdits[0]!;
    expect(edits).toHaveLength(1);
    // One line, and a range narrower than the line it sits on.
    expect(edits[0]!.range.start.line).toBe(edits[0]!.range.end.line);
    expect(edits[0]!.newText).toBe("[300, 128]");

    expect(harness.document.getText()).toBe(SOURCE.replace("[240, 0]", "[300, 128]"));
  });

  it("keeps comments and formatting intact through a drag", async () => {
    await openPanel();
    await harness.fromWebview({ type: "moveNode", nodeId: "work", position: { x: 1, y: 2 } });

    const after = harness.document.getText();
    expect(extractComments(after)).toEqual(extractComments(SOURCE));
    expect(after).toContain("retries: 3");
    expect(after).toContain("  // the expensive step");
  });

  it("adds a node as a pure insertion", async () => {
    await openPanel();
    await harness.fromWebview({ type: "addNode", position: { x: 720, y: 0 } });

    const edits = harness.appliedEdits[0]!;
    expect(edits).toHaveLength(1);
    expect(edits[0]!.range.start).toEqual(edits[0]!.range.end);
    expect(harness.document.getText()).toContain(
      '.node("step1", { kind: "transform", at: [720, 0] })',
    );
  });

  it("adds, renames and deletes, each as its own undoable edit", async () => {
    await openPanel();

    await harness.fromWebview({ type: "addNode", position: { x: 720, y: 0 } });
    await harness.fromWebview({ type: "addEdge", from: "write", to: "step1" });
    await harness.fromWebview({ type: "renameNode", nodeId: "step1", newId: "archive" });
    await harness.fromWebview({ type: "deleteNode", nodeId: "work" });

    // Four gestures, four separate workspace edits: one undo step each, as the user expects.
    expect(harness.appliedEdits).toHaveLength(4);

    const text = harness.document.getText();
    expect(text).toContain('.node("archive"');
    expect(text).toContain('.edge("write", "archive")');
    expect(text).not.toContain('"work"');
    expect(extractComments(text)).toEqual(extractComments(SOURCE));
  });

  it("reports a refused operation instead of corrupting the file", async () => {
    await openPanel();
    await harness.fromWebview({ type: "renameNode", nodeId: "read", newId: 'bad"name' });

    expect(harness.appliedEdits).toHaveLength(0);
    expect(harness.errors.join(" ")).toContain("plain literal");
    expect(harness.document.getText()).toBe(SOURCE);
  });
});

describe("code -> design", () => {
  it("re-parses and pushes a new graph when the file changes on disk", async () => {
    await openPanel();
    const before = harness.lastGraph()!;
    expect(before.nodes.map((n) => n.id)).toEqual(["read", "work", "write"]);

    await harness.typeInEditor(
      SOURCE.replace(
        '  .node("write", { kind: "sink", at: [480, 0] })',
        '  .node("write", { kind: "sink", at: [480, 0] })\n  .node("audit", { kind: "sink", at: [480, 160] })',
      ),
    );

    const after = harness.lastGraph()!;
    expect(after.nodes.map((n) => n.id)).toEqual(["read", "work", "write", "audit"]);
  });

  it("moves a node rather than recreating it when the source position changes", async () => {
    await openPanel();
    await harness.typeInEditor(SOURCE.replace("at: [240, 0]", "at: [600, 320]"));

    const graph = harness.lastGraph()!;
    const work = graph.nodes.find((n) => n.id === "work")!;
    expect(work.position).toEqual({ x: 600, y: 320 });
    // The other two nodes are the same objects by identity (same id, same position).
    expect(graph.nodes.map((n) => n.id)).toEqual(["read", "work", "write"]);
  });

  it("closes the loop: a drag ends with the canvas showing the file's own value", async () => {
    await openPanel();
    await harness.fromWebview({ type: "moveNode", nodeId: "read", position: { x: 64, y: 64 } });

    // The canvas was never told "you moved it"; it was told what the file now says.
    const graph = harness.lastGraph()!;
    expect(graph.nodes.find((n) => n.id === "read")!.position).toEqual({ x: 64, y: 64 });
    expect(harness.document.getText()).toContain("at: [64, 64]");
  });
});

describe("selection sync", () => {
  it("maps a text cursor inside a node's span back to that node", async () => {
    await openPanel();

    const offset = SOURCE.indexOf('.node("work"') + 4;
    await harness.moveCursorTo(offset);
    expect(harness.lastReveal()).toBe("work");

    await harness.moveCursorTo(SOURCE.indexOf("import"));
    expect(harness.lastReveal()).toBeUndefined();
  });
});

describe("files the parser only partly understands", () => {
  it("still opens, and still patches the parts it understands", async () => {
    const source = [
      'import { flow } from "@twowayflow/dsl";',
      "",
      'const dynamic = "x";',
      "",
      'export default flow("partial")',
      '  .node("ok", { kind: "source", at: [0, 0] })',
      '  .node(dynamic, { kind: "transform" })',
      '  .edge("ok", "ok");',
      "",
    ].join("\n");

    await openPanel(source);
    const graph = harness.lastGraph()!;
    expect(graph.nodes.map((n) => n.id)).toEqual(["ok"]);

    await harness.fromWebview({ type: "moveNode", nodeId: "ok", position: { x: 9, y: 9 } });
    const text = harness.document.getText();
    expect(text).toContain('.node(dynamic, { kind: "transform" })');
    expect(text).toContain("at: [9, 9]");
  });
});
