/**
 * `twowayflow: New Diagram Request` — the wizard around `buildRequest`.
 *
 * It asks the six things a request has to name, then hands the request to Claude Code: either
 * `claude '<request>'` in a terminal opened in the project being diagrammed, or the clipboard
 * plus the Claude Code side bar. Which one is `twowayflow.diagramRequest.handoff`; the clipboard
 * is also the fallback when `claude` is not on PATH, because a terminal would only echo
 * "command not found".
 *
 * It deliberately does not run `twf-diagram start` itself. One owner for the whole ritual means
 * a dirty tree or exit code 2 is something you talk about, not a notification toast.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import {
  buildRequest,
  NOTATIONS,
  type Notation,
  onPath as onPathDefault,
  terminalCommand,
  validateSlug,
} from "./diagramRequest.js";

const CLAUDE = "claude";
const SCRIPT = "scripts/twf-diagram";
const SIDEBAR = "claude-vscode.sidebar.open";
const LAST_REPO = "twowayflow.lastDiagramRepo";

/** `onPath` is injected so tests can say whether `claude` exists instead of depending on PATH. */
export interface Deps {
  readonly onPath?: (binary: string) => boolean;
}

export async function newDiagramRequest(
  context: vscode.ExtensionContext,
  deps: Deps = {},
): Promise<void> {
  const repo = await pickRepo(context);
  if (repo === undefined) return;

  const subject = await askFor({
    title: "What does the diagram show?",
    placeHolder: "POST /api/perguntar — one request in time",
  });
  if (subject === undefined) return;

  const notation = await pickNotation();
  if (notation === undefined) return;

  const slug = await vscode.window.showInputBox({
    title: "Slug",
    placeHolder: "turno-sequencia",
    prompt: "Becomes the branch, the file name and the row in the folder index.",
    validateInput: validateSlug,
    ignoreFocusOut: true,
  });
  if (slug === undefined) return;

  const title = await askFor({
    title: "Title",
    placeHolder: "One turn in time",
    prompt: "The heading, and the commit subject when it lands.",
  });
  if (title === undefined) return;

  // Esc here cancels, like everywhere else; empty is the answer that hands the description over.
  const description = await vscode.window.showInputBox({
    title: "Titleblock description",
    prompt: "What this shows and what it is read off. Leave empty and Claude writes it.",
    ignoreFocusOut: true,
  });
  if (description === undefined) return;

  const pr = await vscode.window.showQuickPick(["Open a PR", "Branch and commit only"], {
    title: "When it lands",
    ignoreFocusOut: true,
  });
  if (pr === undefined) return;

  await context.globalState.update(LAST_REPO, repo);

  const request = buildRequest({
    repo,
    subject,
    notation,
    slug,
    title,
    description,
    script: scriptPath(),
    pr: pr === "Open a PR",
  });

  await handOff(request, repo, deps.onPath ?? onPathDefault);
}

// --- the questions --------------------------------------------------------------------------

async function askFor(options: {
  title: string;
  placeHolder: string;
  prompt?: string;
}): Promise<string | undefined> {
  const answer = await vscode.window.showInputBox({
    ...options,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() === "" ? "required" : undefined),
  });
  return answer?.trim();
}

async function pickRepo(context: vscode.ExtensionContext): Promise<string | undefined> {
  const BROWSE = "Browse…";
  const remembered = context.globalState.get<string>(LAST_REPO);
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  // The project being diagrammed is usually not this workspace, so the last one used comes first.
  const known = [...new Set([...(remembered ? [remembered] : []), ...folders])];

  const picked = await vscode.window.showQuickPick([...known, BROWSE], {
    title: "Which project does the diagram describe?",
    placeHolder: "where docs/twowayflow/ and the branch will go",
    ignoreFocusOut: true,
  });
  if (picked === undefined) return undefined;
  if (picked !== BROWSE) return picked;

  const chosen = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Diagram this project",
  });
  return chosen?.[0]?.fsPath;
}

async function pickNotation(): Promise<Notation | undefined> {
  const OTHER = "Other…";
  const items = [
    ...NOTATIONS.map((notation) => ({
      label: notation.phrase,
      description: notation.type,
      notation,
    })),
    { label: OTHER, description: "name the notation yourself", notation: undefined },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: "Which notation?",
    placeHolder: "what reaches --type, and so the titleblock's Type row",
    ignoreFocusOut: true,
  });
  if (picked === undefined) return undefined;
  if (picked.notation !== undefined) return picked.notation;

  // A hand-written notation is both the Type row and how the request reads, because the script
  // takes any string and there is nothing to translate it against.
  const type = await askFor({
    title: "Notation",
    placeHolder: "Petri net — Mermaid",
    prompt: "Goes in the titleblock's Type row verbatim.",
  });
  return type === undefined ? undefined : { phrase: type, type };
}

// --- where twf-diagram lives ----------------------------------------------------------------

/**
 * The script lives in the twowayflow checkout, while the terminal starts in the project being
 * diagrammed — so the request has to name it absolutely, or Claude is told to run something that
 * is not there.
 */
function scriptPath(): string {
  const configured = vscode.workspace
    .getConfiguration("twowayflow")
    .get<string>("diagramRequest.scriptPath", "")
    .trim();
  if (configured !== "") return configured;

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const candidate = join(folder.uri.fsPath, SCRIPT);
    if (existsSync(candidate)) return candidate;
  }

  void vscode.window.showWarningMessage(
    `twowayflow: no ${SCRIPT} in this workspace — the request names it relatively. ` +
      "Set twowayflow.diagramRequest.scriptPath to the twowayflow checkout's copy.",
  );
  return SCRIPT;
}

// --- the handoff ----------------------------------------------------------------------------

async function handOff(
  request: string,
  cwd: string,
  onPath: (binary: string) => boolean,
): Promise<void> {
  const handoff = vscode.workspace
    .getConfiguration("twowayflow")
    .get<string>("diagramRequest.handoff", "terminal");

  if (handoff === "terminal" && onPath(CLAUDE)) {
    const terminal = vscode.window.createTerminal({ name: "twowayflow: diagram", cwd });
    terminal.show();
    terminal.sendText(terminalCommand(request, CLAUDE));
    return;
  }

  await vscode.env.clipboard.writeText(request);
  try {
    await vscode.commands.executeCommand(SIDEBAR);
  } catch {
    // Claude Code may not be installed. The request is on the clipboard either way.
  }
  const why = handoff === "terminal" ? ` (\`${CLAUDE}\` is not on PATH)` : "";
  void vscode.window.showInformationMessage(
    `twowayflow: diagram request copied — paste it into Claude Code${why}.`,
  );
}
