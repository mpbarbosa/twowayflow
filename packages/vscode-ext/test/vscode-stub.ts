/**
 * The slice of the VS Code API that `FlowPanel` touches, in memory.
 *
 * This exists so the design -> code -> design loop can be exercised without a VS Code instance.
 * It is deliberately faithful about the two things that matter: `WorkspaceEdit.replace` records
 * ranged edits, and `applyEdit` applies them to an in-memory document which then fires
 * `onDidChangeTextDocument` — which is exactly how the real round trip closes.
 */

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
}

export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position,
  ) {}
}

export class Selection extends Range {
  /** Where the caret is. `FlowPanel` reads this to map the cursor back to a node. */
  get active(): Position {
    return this.end;
  }
}

export const ViewColumn = { Beside: 2, One: 1 } as const;
export const TextEditorRevealType = { InCenterIfOutsideViewport: 2 } as const;

export const Uri = {
  joinPath: (base: { fsPath: string; path: string }, ...parts: string[]) => {
    const path = [base.path, ...parts].join("/");
    return { fsPath: path, path, toString: () => `file://${path}` };
  },
  file: (path: string) => ({ fsPath: path, path, toString: () => `file://${path}` }),
};

type Listener<T> = (event: T) => void;

class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  readonly event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  fire(event: T): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

let documentCounter = 0;

export class StubDocument {
  // Unique per instance: `FlowPanel` keys open panels by document URI, so reusing one would
  // hand every test the first test's panel.
  readonly uri = Uri.file(`/workspace/test${documentCounter++}.flow.ts`);

  constructor(private text: string) {}

  getText(): string {
    return this.text;
  }

  setText(next: string): void {
    this.text = next;
  }

  offsetAt(position: Position): number {
    const lines = this.text.split("\n");
    let offset = 0;
    for (let i = 0; i < position.line; i += 1) offset += (lines[i]?.length ?? 0) + 1;
    return offset + position.character;
  }

  positionAt(offset: number): Position {
    const before = this.text.slice(0, offset);
    const lines = before.split("\n");
    return new Position(lines.length - 1, lines[lines.length - 1]!.length);
  }
}

export interface RecordedEdit {
  readonly range: Range;
  readonly newText: string;
}

export class WorkspaceEdit {
  readonly edits: RecordedEdit[] = [];

  replace(_uri: unknown, range: Range, newText: string): void {
    this.edits.push({ range, newText });
  }
}

// --------------------------------------------------------------------------------------------
// The mutable test harness state
// --------------------------------------------------------------------------------------------

export interface WebviewMessageLog {
  readonly toWebview: unknown[];
}

const documentChange = new Emitter<{ document: StubDocument; contentChanges: unknown[] }>();
const selectionChange = new Emitter<{
  textEditor: { document: StubDocument };
  selections: Selection[];
}>();

export const harness = {
  document: new StubDocument(""),
  /** Messages the extension posted to the webview. */
  toWebview: [] as unknown[],
  /** The webview's own message handler, captured when the panel registers it. */
  webviewHandler: undefined as ((message: unknown) => void) | undefined,
  /** Every WorkspaceEdit the panel applied, in order. */
  appliedEdits: [] as RecordedEdit[][],
  warnings: [] as string[],
  errors: [] as string[],
  revealedRanges: [] as Range[],
  html: "",

  reset(text: string) {
    this.document = new StubDocument(text);
    this.toWebview = [];
    this.webviewHandler = undefined;
    this.appliedEdits = [];
    this.warnings = [];
    this.errors = [];
    this.revealedRanges = [];
    this.html = "";
    disposeHooks.splice(0, disposeHooks.length);
  },

  /** Simulate the webview sending a message, as a drag or a double-click would. */
  async fromWebview(message: unknown): Promise<void> {
    await this.webviewHandler?.(message);
    await flushTimers();
  },

  /** Simulate the user typing in the text editor. */
  async typeInEditor(next: string): Promise<void> {
    this.document.setText(next);
    documentChange.fire({ document: this.document, contentChanges: [{}] });
    await flushTimers();
  },

  /** Simulate the text cursor moving. */
  async moveCursorTo(offset: number): Promise<void> {
    const position = this.document.positionAt(offset);
    selectionChange.fire({
      textEditor: { document: this.document },
      selections: [new Selection(position, position)],
    });
    await flushTimers();
  },

  lastGraph():
    | {
        nodes: { id: string; position?: { x: number; y: number } }[];
        edges: { id: string; from: string; to: string }[];
      }
    | undefined {
    const graphs = this.toWebview.filter(
      (m): m is { type: "graph"; graph: { nodes: { id: string }[] } } =>
        typeof m === "object" && m !== null && (m as { type?: string }).type === "graph",
    );
    return graphs[graphs.length - 1]?.graph as never;
  },

  lastReveal(): string | undefined {
    const reveals = this.toWebview.filter(
      (m): m is { type: "reveal"; nodeId?: string } =>
        typeof m === "object" && m !== null && (m as { type?: string }).type === "reveal",
    );
    return reveals[reveals.length - 1]?.nodeId;
  },
};

const disposeHooks: (() => void)[] = [];

/** The panel debounces its re-parse, so tests have to let the timer run. */
async function flushTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

export const window = {
  visibleTextEditors: [] as { document: StubDocument; revealRange: unknown; selection: unknown }[],

  createWebviewPanel(_id: string, _title: string, _column: unknown, _options: unknown) {
    const panel = {
      webview: {
        cspSource: "vscode-webview:",
        set html(value: string) {
          harness.html = value;
        },
        get html() {
          return harness.html;
        },
        asWebviewUri: (uri: { toString(): string }) => uri,
        postMessage: (message: unknown) => {
          harness.toWebview.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (handler: (message: unknown) => void) => {
          harness.webviewHandler = handler;
          return { dispose: () => {} };
        },
      },
      reveal: () => {},
      onDidDispose: (handler: () => void) => {
        disposeHooks.push(handler);
        return { dispose: () => {} };
      },
    };
    return panel;
  },

  onDidChangeTextEditorSelection: selectionChange.event,

  showWarningMessage: (message: string) => {
    harness.warnings.push(message);
    return Promise.resolve(undefined);
  },
  showErrorMessage: (message: string) => {
    harness.errors.push(message);
    return Promise.resolve(undefined);
  },
  showInformationMessage: () => Promise.resolve(undefined),
  get activeTextEditor() {
    return undefined;
  },
};

export const workspace = {
  onDidChangeTextDocument: documentChange.event,

  getConfiguration: () => ({ get: <T>(_key: string, fallback: T) => fallback }),

  applyEdit: (edit: WorkspaceEdit) => {
    harness.appliedEdits.push([...edit.edits]);

    // Apply ranged edits back-to-front, exactly as VS Code does, so offsets stay valid.
    const document = harness.document;
    const ranged = edit.edits
      .map((e) => ({
        start: document.offsetAt(e.range.start),
        end: document.offsetAt(e.range.end),
        newText: e.newText,
      }))
      .sort((a, b) => b.start - a.start || b.end - a.end);

    let text = document.getText();
    for (const e of ranged) text = text.slice(0, e.start) + e.newText + text.slice(e.end);
    document.setText(text);

    documentChange.fire({ document, contentChanges: [{}] });
    return Promise.resolve(true);
  },
};

export const commands = {
  registered: new Map<string, (...args: unknown[]) => unknown>(),
  registerCommand(id: string, handler: (...args: unknown[]) => unknown) {
    commands.registered.set(id, handler);
    return { dispose: () => commands.registered.delete(id) };
  },
};

export default {
  Position,
  Range,
  Selection,
  Uri,
  ViewColumn,
  TextEditorRevealType,
  WorkspaceEdit,
  window,
  workspace,
  commands,
};
