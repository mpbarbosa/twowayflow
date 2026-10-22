/**
 * The same loop, in a real VS Code extension host.
 *
 * `test/roundtrip-loop.test.ts` proves the wiring against a stub. This proves the things a stub
 * cannot: that the extension activates in VS Code, that the tree-sitter WASM loads from `dist/`
 * inside the real host, that the canvas panel opens for a `.flow.ts` file, and that a patch
 * applied through `vscode.workspace.applyEdit` is an ordinary text edit — so plain `undo`
 * restores the file exactly.
 *
 * Deliberately no test framework: the runner just calls `run()`, and one `assert` failure is
 * enough to fail the job.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { applyPatch, extractComments, getParser, parseFlowSourceWith } from "@twowayflow/core";
import * as vscode from "vscode";
import { toCanvasGraph } from "../src/graph.js";

type Case = [name: string, body: () => Promise<void>];

async function openExample(name: string): Promise<vscode.TextDocument> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the test workspace should have a folder open");
  const uri = vscode.Uri.joinPath(folder.uri, name);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
  return document;
}

const EXTENSION_ID = "twowayflow.twowayflow-vscode";

function extension(): vscode.Extension<unknown> {
  const found = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(found, `${EXTENSION_ID} should be loaded in the test host`);
  return found;
}

/**
 * The WASM paths the extension itself uses. Asserting they exist is the point: it proves the
 * build copied them into `dist/`, rather than silently falling back to node_modules.
 */
function wasmPaths() {
  const root = extension().extensionUri;
  const paths = {
    runtimeWasmPath: vscode.Uri.joinPath(root, "dist", "web-tree-sitter.wasm").fsPath,
    languageWasmPath: vscode.Uri.joinPath(root, "dist", "tree-sitter-typescript.wasm").fsPath,
  };
  for (const path of Object.values(paths)) {
    assert.ok(existsSync(path), `${path} should have been copied into dist/ by the build`);
  }
  return paths;
}

const cases: Case[] = [
  [
    "the extension activates and registers its command",
    async () => {
      // The extension declares no activation events: `contributes.commands` gives it implicit
      // onCommand activation. So activate it explicitly before asking what it registered,
      // rather than relying on some earlier case having opened a file first.
      await extension().activate();
      assert.ok(extension().isActive, "the extension should be active after activate()");

      const commands = await vscode.commands.getCommands(true);
      // Every command `contributes.commands` declares, or the palette offers one that answers
      // "command not found" — which no unit test can see.
      for (const id of ["twowayflow.openCanvas", "twowayflow.newDiagramRequest"]) {
        assert.ok(commands.includes(id), `${id} should be registered`);
      }
    },
  ],

  [
    "the tree-sitter grammar loads inside the extension host and parses an example",
    async () => {
      const document = await openExample("orders-etl.flow.ts");
      const parser = await getParser(wasmPaths());
      const file = parseFlowSourceWith(parser, document.getText());

      assert.equal(file.name, "orders-etl");
      assert.deepEqual(
        file.nodes.map((n) => n.id),
        ["readCsv", "parseRows", "dropIncomplete", "writeDb"],
      );
      assert.deepEqual(file.diagnostics, []);
    },
  ],

  [
    "the canvas panel opens for a .flow.ts file",
    async () => {
      await openExample("sensor-fusion.flow.ts");
      // Throwing here is the failure: opening the panel constructs the webview, loads the
      // WASM via the extension's own code path, and parses the document.
      await vscode.commands.executeCommand("twowayflow.openCanvas");
    },
  ],

  [
    "a drag lands as an ordinary text edit that plain undo reverses",
    async () => {
      const document = await openExample("orders-etl.flow.ts");
      const original = document.getText();

      const parser = await getParser(wasmPaths());
      const file = parseFlowSourceWith(parser, original);
      const { edits } = applyPatch(file, [
        { op: "moveNode", id: "parseRows", position: { x: 333, y: 444 } },
      ]);
      assert.equal(edits.length, 1, "moving a node with an `at` is a single edit");

      const workspaceEdit = new vscode.WorkspaceEdit();
      for (const edit of edits) {
        workspaceEdit.replace(
          document.uri,
          new vscode.Range(
            document.positionAt(edit.range.start),
            document.positionAt(edit.range.end),
          ),
          edit.newText,
        );
      }
      assert.ok(await vscode.workspace.applyEdit(workspaceEdit), "the edit should apply");

      const after = document.getText();
      assert.ok(after.includes("at: [333, 444]"), "the new position should be in the file");
      assert.ok(after.includes("run: (rows: string[])"), "the closure should be untouched");
      assert.deepEqual(
        extractComments(after),
        extractComments(original),
        "every comment should survive",
      );
      assert.ok(document.isDirty, "the document should be dirty, like any other edit");

      // The claim being tested: this is a normal text edit, so normal undo undoes it.
      await vscode.commands.executeCommand("undo");
      assert.equal(document.getText(), original, "undo should restore the file byte-for-byte");
    },
  ],

  [
    "the graph the canvas is sent carries each node's description",
    async () => {
      const document = await openExample("pessoa-rag.flow.ts");
      await vscode.commands.executeCommand("twowayflow.openCanvas");

      const parser = await getParser(wasmPaths());
      // The same projection the panel pushes to the webview, so this is the data the hover
      // renders — not a re-derivation of it.
      const graph = toCanvasGraph(parseFlowSourceWith(parser, document.getText()), 1);

      const undescribed = graph.nodes.filter((n) => n.description === undefined).map((n) => n.id);
      assert.deepEqual(
        undescribed,
        [],
        "every node in the example should reach the canvas described",
      );
      assert.match(
        graph.nodes.find((n) => n.id === "fundirRrf")!.description!,
        /reciprocal rank/,
        "the description should be the file's own prose, not the label or the id",
      );
    },
  ],

  [
    "a file with links the parser cannot read still opens",
    async () => {
      const folder = vscode.workspace.workspaceFolders![0]!;
      const uri = vscode.Uri.joinPath(folder.uri, "partial.flow.ts");
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
      await vscode.workspace.fs.writeFile(uri, Buffer.from(source, "utf8"));

      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
      await vscode.commands.executeCommand("twowayflow.openCanvas");

      const parser = await getParser(wasmPaths());
      const file = parseFlowSourceWith(parser, document.getText());
      assert.deepEqual(
        file.nodes.map((n) => n.id),
        ["ok"],
      );
      assert.equal(file.unknownLinks.length, 1);

      await vscode.workspace.fs.delete(uri);
    },
  ],
];

export async function run(): Promise<void> {
  const failures: string[] = [];

  for (const [name, body] of cases) {
    try {
      await body();
      console.log(`  ok   ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`  FAIL ${name}`);
      console.error(`       ${error instanceof Error ? error.stack : String(error)}`);
    }
  }

  console.log(`\n  ${cases.length - failures.length}/${cases.length} integration cases passed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} integration case(s) failed: ${failures.join(", ")}`);
  }
}
