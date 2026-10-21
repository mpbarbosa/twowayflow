import * as vscode from "vscode";
import { FlowPanel } from "./panel.js";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("twowayflow.openCanvas", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showInformationMessage("twowayflow: open a *.flow.ts file first.");
        return;
      }
      if (!editor.document.uri.path.endsWith(".flow.ts")) {
        void vscode.window.showInformationMessage(
          "twowayflow: the canvas only opens for *.flow.ts files.",
        );
        return;
      }
      await FlowPanel.open(editor.document, context.extensionUri);
    }),
  );
}

export function deactivate(): void {
  // Panels dispose themselves via their own onDidDispose handlers.
}
