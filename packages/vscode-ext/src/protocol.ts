import type { Diagnostic, FlowGraphSpec, Span } from "@twowayflow/core";

/** A node as the canvas needs it: graph data plus the source range it came from. */
export interface CanvasNode {
  readonly id: string;
  readonly kind?: string;
  readonly label?: string;
  /** Shown when the pointer rests on the node. Never patched back. */
  readonly description?: string;
  readonly position?: { x: number; y: number };
  /** Where this node lives in the file. The reason selection sync works at all. */
  readonly span: Span;
  readonly hasExplicitPosition: boolean;
}

export interface CanvasEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly span: Span;
}

/** A chain link the parser refused. Drawn as an opaque box; never patched. */
export interface CanvasUnknown {
  readonly id: string;
  readonly text: string;
  readonly reason: string;
  readonly span: Span;
}

export interface CanvasGraph {
  readonly name?: string;
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  readonly unknown: readonly CanvasUnknown[];
  readonly diagnostics: readonly Diagnostic[];
  /** Bumped on every re-parse, so the webview can ignore stale messages. */
  readonly revision: number;
}

export type ExtensionToWebview =
  | { readonly type: "graph"; readonly graph: CanvasGraph }
  | { readonly type: "reveal"; readonly nodeId: string | undefined }
  | { readonly type: "error"; readonly message: string };

export type WebviewToExtension =
  | {
      readonly type: "moveNode";
      readonly nodeId: string;
      readonly position: { x: number; y: number };
    }
  | { readonly type: "renameNode"; readonly nodeId: string; readonly newId: string }
  | { readonly type: "deleteNode"; readonly nodeId: string }
  | { readonly type: "addNode"; readonly position: { x: number; y: number } }
  | { readonly type: "addEdge"; readonly from: string; readonly to: string }
  | { readonly type: "deleteEdge"; readonly edgeId: string }
  | { readonly type: "selectNode"; readonly nodeId: string | undefined }
  | { readonly type: "ready" };

export type { Diagnostic, FlowGraphSpec };
