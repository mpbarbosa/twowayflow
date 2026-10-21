import { existsSync } from "node:fs";
import {
  applyEdits,
  type FlowFile,
  type FlowOp,
  getParser,
  type LanguageOptions,
  PatchError,
  parseFlowSourceWith,
  patch,
  type Span,
  suggestEdgeId,
} from "@twowayflow/core";
import * as vscode from "vscode";
import type { Parser } from "web-tree-sitter";
import { toCanvasGraph } from "./graph.js";
import type { ExtensionToWebview, WebviewToExtension } from "./protocol.js";

/**
 * How long to wait after a document change before re-parsing.
 *
 * There is no "Sync" button anywhere: the canvas follows the file continuously. The delay only
 * exists so that holding a key down does not queue a parse per keystroke.
 */
const REPARSE_DEBOUNCE_MS = 60;

/**
 * Where to load the two WASM files from.
 *
 * A packaged extension cannot resolve node_modules, so the build copies both into `dist/` and
 * they are addressed by absolute path. When `dist/` has not been built — running the extension
 * host straight from source — fall back to node_modules resolution rather than failing with an
 * opaque emscripten abort.
 */
function wasmOptions(extensionUri: vscode.Uri): LanguageOptions {
  const runtime = vscode.Uri.joinPath(extensionUri, "dist", "web-tree-sitter.wasm").fsPath;
  const grammar = vscode.Uri.joinPath(extensionUri, "dist", "tree-sitter-typescript.wasm").fsPath;
  if (!existsSync(runtime) || !existsSync(grammar)) return {};
  return { runtimeWasmPath: runtime, languageWasmPath: grammar };
}

export class FlowPanel {
  private static readonly byDocument = new Map<string, FlowPanel>();

  private file: FlowFile;
  private revision = 0;
  private reparseTimer: NodeJS.Timeout | undefined;
  /** Set while this panel is applying its own edit, so the resulting change is not echoed. */
  private applyingOwnEdit = false;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly document: vscode.TextDocument,
    private readonly parser: Parser,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.file = parseFlowSourceWith(this.parser, this.document.getText());
    this.panel.webview.html = this.html();

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: WebviewToExtension) =>
        this.onMessage(message),
      ),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== this.document.uri.toString()) return;
        if (event.contentChanges.length === 0) return;
        this.scheduleReparse();
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor.document.uri.toString() !== this.document.uri.toString()) return;
        this.revealFromCursor(event.selections[0]?.active);
      }),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  static async open(document: vscode.TextDocument, extensionUri: vscode.Uri): Promise<FlowPanel> {
    const key = document.uri.toString();
    const existing = FlowPanel.byDocument.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      return existing;
    }

    const parser = await getParser(wasmOptions(extensionUri));
    const panel = vscode.window.createWebviewPanel(
      "twowayflow.canvas",
      `Flow: ${document.uri.path.split("/").pop() ?? "untitled"}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    const flowPanel = new FlowPanel(panel, document, parser, extensionUri);
    FlowPanel.byDocument.set(key, flowPanel);
    return flowPanel;
  }

  private dispose(): void {
    FlowPanel.byDocument.delete(this.document.uri.toString());
    if (this.reparseTimer) clearTimeout(this.reparseTimer);
    for (const disposable of this.disposables) disposable.dispose();
  }

  // ------------------------------------------------------------------------------------------
  // code -> design
  // ------------------------------------------------------------------------------------------

  private scheduleReparse(): void {
    if (this.reparseTimer) clearTimeout(this.reparseTimer);
    this.reparseTimer = setTimeout(() => {
      this.reparseTimer = undefined;
      this.reparse();
    }, REPARSE_DEBOUNCE_MS);
  }

  private reparse(): void {
    this.file = parseFlowSourceWith(this.parser, this.document.getText());
    this.revision += 1;
    this.post({ type: "graph", graph: toCanvasGraph(this.file, this.revision) });
  }

  private post(message: ExtensionToWebview): void {
    void this.panel.webview.postMessage(message);
  }

  // ------------------------------------------------------------------------------------------
  // design -> code
  // ------------------------------------------------------------------------------------------

  private async onMessage(message: WebviewToExtension): Promise<void> {
    switch (message.type) {
      case "ready":
        this.reparse();
        return;
      case "selectNode":
        this.revealInEditor(message.nodeId);
        return;
      case "moveNode":
        await this.applyOps([{ op: "moveNode", id: message.nodeId, position: message.position }]);
        return;
      case "renameNode":
        await this.applyOps([{ op: "renameNode", id: message.nodeId, newId: message.newId }]);
        return;
      case "deleteNode":
        await this.applyOps([{ op: "deleteNode", id: message.nodeId }]);
        return;
      case "addNode":
        await this.applyOps([
          {
            op: "addNode",
            id: this.freshNodeId(),
            kind: "transform",
            position: message.position,
          },
        ]);
        return;
      case "addEdge": {
        // Declare an id when this would be the second or later edge between the same pair, so
        // that deleting one parallel edge cannot change what its siblings mean. The first edge
        // of a pair gets none: `from->to` already identifies it unambiguously.
        const id = suggestEdgeId(this.file.edges, message.from, message.to);
        await this.applyOps([
          {
            op: "addEdge",
            from: message.from,
            to: message.to,
            ...(id === undefined ? {} : { id }),
          },
        ]);
        return;
      }
      case "deleteEdge":
        await this.applyOps([{ op: "deleteEdge", edgeId: message.edgeId }]);
        return;
    }
  }

  private freshNodeId(): string {
    const taken = new Set(this.file.nodes.map((n) => n.id));
    for (let i = 1; ; i += 1) {
      const candidate = `step${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /**
   * Turn canvas ops into a `WorkspaceEdit` of ranged replacements.
   *
   * This is where the architecture is either true or false. Nothing here regenerates the file:
   * each op becomes one `edit.replace(uri, range, text)` whose range came from the parse. VS
   * Code therefore gets a normal text edit, which means undo, multi-cursor, git gutters and
   * dirty state all behave exactly as they do for typing.
   */
  private async applyOps(ops: readonly FlowOp[]): Promise<void> {
    // Re-parse first: a debounced parse may still be pending, and patching against stale
    // offsets would corrupt the file rather than merely getting the wrong answer.
    if (this.reparseTimer) {
      clearTimeout(this.reparseTimer);
      this.reparseTimer = undefined;
      this.file = parseFlowSourceWith(this.parser, this.document.getText());
    }

    let edits: readonly { range: Span; newText: string; reason: string }[];
    try {
      const result = patch(this.file, ops);
      edits = result.edits;
      for (const warning of result.warnings) {
        void vscode.window.showWarningMessage(`twowayflow: ${warning.message}`);
      }
    } catch (error) {
      const message = error instanceof PatchError ? error.message : String(error);
      void vscode.window.showErrorMessage(`twowayflow: ${message}`);
      this.reparse();
      return;
    }

    if (edits.length === 0) return;

    // Guard: the patch must be expressible as ranged edits over the text we parsed. If the
    // document moved underneath us, bail out instead of writing nonsense.
    if (this.document.getText() !== this.file.source) {
      this.reparse();
      return;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
      workspaceEdit.replace(this.document.uri, this.toRange(edit.range), edit.newText);
    }

    this.applyingOwnEdit = true;
    try {
      const ok = await vscode.workspace.applyEdit(workspaceEdit);
      if (!ok) void vscode.window.showErrorMessage("twowayflow: the workspace edit was rejected.");
    } finally {
      this.applyingOwnEdit = false;
    }

    // The document-change listener re-parses, which pushes the new graph back to the canvas.
    // That is the round trip: the canvas never updates itself from its own gesture.
    this.scheduleReparse();
  }

  // ------------------------------------------------------------------------------------------
  // Selection sync, both directions
  // ------------------------------------------------------------------------------------------

  private toRange(span: Span): vscode.Range {
    return new vscode.Range(
      this.document.positionAt(span.start),
      this.document.positionAt(span.end),
    );
  }

  private revealInEditor(nodeId: string | undefined): void {
    if (!nodeId) return;
    if (!vscode.workspace.getConfiguration("twowayflow").get("revealOnCanvasSelect", true)) return;

    const node = this.file.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.document.uri.toString(),
    );
    if (!editor) return;

    const range = this.toRange(node.link.span);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.selection = new vscode.Selection(range.start, range.end);
  }

  private revealFromCursor(position: vscode.Position | undefined): void {
    if (!position || this.applyingOwnEdit) return;
    const offset = this.document.offsetAt(position);
    const node = this.file.nodes.find(
      (n) => n.link.span.start <= offset && offset <= n.link.span.end,
    );
    this.post({ type: "reveal", nodeId: node?.id });
  }

  // ------------------------------------------------------------------------------------------
  // Webview shell
  // ------------------------------------------------------------------------------------------

  private html(): string {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js"),
    );
    const styles = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css"),
    );
    const nonce = Array.from({ length: 32 }, () =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(
        Math.floor(Math.random() * 62),
      ),
    ).join("");

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${styles}" />
    <title>Flow canvas</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }
}

export { applyEdits };
