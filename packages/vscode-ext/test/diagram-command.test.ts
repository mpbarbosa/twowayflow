/**
 * The wizard and the handoff, driven through the stubbed VS Code API.
 *
 * `diagram-request.test.ts` proves the sentence is right. This proves the *wiring*: that the
 * answers reach the sentence in the order asked, that the terminal starts in the project being
 * diagrammed, that the clipboard route is taken when the setting says so *and* when `claude` is
 * not there to run, and that Esc leaves nothing behind.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settings, ui, workspace } from "./vscode-stub.js";

const { newDiagramRequest } = await import("../src/diagramCommand.js");

const REPO = "/home/mpb/src/pessoabot";
const SCRIPT = "/home/mpb/src/twowayflow/scripts/twf-diagram";

/** An ExtensionContext with the one thing the wizard uses: somewhere to remember the last repo. */
function newContext() {
  const state = new Map<string, unknown>();
  return {
    globalState: {
      get: (key: string) => state.get(key),
      update: (key: string, value: unknown) => {
        state.set(key, value);
        return Promise.resolve();
      },
    },
  } as never;
}

/** The seven answers, in the order the wizard asks for them. */
function answerEverything(): void {
  ui.quickPicks = [REPO, "sequence diagram (Mermaid)", "Open a PR"];
  ui.inputs = [
    "POST /api/perguntar",
    "turno-sequencia",
    "One turn in time",
    "One turn of POST /api/perguntar in time: the lock, and the guard that runs late.",
  ];
}

const present = { onPath: () => true };
const missing = { onPath: () => false };

beforeEach(() => {
  harness.reset("");
  workspace.workspaceFolders = [{ uri: { fsPath: REPO, path: REPO } }];
  settings.set("twowayflow.diagramRequest.scriptPath", SCRIPT);
});

describe("the terminal handoff", () => {
  it("runs claude in the project being diagrammed", async () => {
    answerEverything();

    await newDiagramRequest(newContext(), present);

    expect(ui.terminals).toHaveLength(1);
    const terminal = ui.terminals[0]!;
    // The cwd is the project, not this workspace, because that is what Claude has to read.
    expect(terminal.cwd).toBe(REPO);
    expect(terminal.shown).toBe(true);
    expect(terminal.sent).toHaveLength(1);

    const sent = terminal.sent[0]!;
    expect(sent.startsWith("claude '")).toBe(true);
    for (const fragment of [
      "sequence diagram (Mermaid)",
      "POST /api/perguntar",
      REPO,
      "turno-sequencia",
      '"One turn in time"',
      SCRIPT,
      "and open the PR",
    ]) {
      expect(sent, fragment).toContain(fragment);
    }
    expect(ui.clipboard).toBe("");
  });

  it("asks for the repo, the subject, the notation, the slug, the title, the description, the PR", async () => {
    answerEverything();

    await newDiagramRequest(newContext(), present);

    expect(ui.asked).toEqual([
      "Which project does the diagram describe?",
      "What does the diagram show?",
      "Which notation?",
      "Slug",
      "Title",
      "Titleblock description",
      "When it lands",
    ]);
  });

  it("offers a hand-written notation, and uses it as the Type row", async () => {
    answerEverything();
    ui.quickPicks[1] = "Other…";
    ui.inputs.splice(1, 0, "Petri net — Mermaid"); // asked right after the pick

    await newDiagramRequest(newContext(), present);

    expect(ui.terminals[0]!.sent[0]!).toContain('type "Petri net — Mermaid"');
  });
});

describe("the clipboard handoff", () => {
  it("copies the request and opens the Claude Code side bar", async () => {
    settings.set("twowayflow.diagramRequest.handoff", "clipboard");
    answerEverything();

    await newDiagramRequest(newContext(), present);

    expect(ui.terminals).toHaveLength(0);
    expect(ui.clipboard).toContain("Draw a sequence diagram (Mermaid) of POST /api/perguntar");
    expect(ui.executed).toEqual(["claude-vscode.sidebar.open"]);
    expect(ui.infos[0]).toContain("paste it into Claude Code");
    // Nothing about PATH: the clipboard was the choice, not a fallback.
    expect(ui.infos[0]).not.toContain("PATH");
  });

  it("is the fallback when claude is not on PATH, and says why", async () => {
    answerEverything();

    await newDiagramRequest(newContext(), missing);

    expect(ui.terminals).toHaveLength(0);
    expect(ui.clipboard).toContain("turno-sequencia");
    expect(ui.infos[0]).toContain("is not on PATH");
  });
});

describe("what it does not do", () => {
  it("leaves nothing behind when you press Esc", async () => {
    answerEverything();
    ui.inputs[1] = undefined; // Esc at the slug

    await newDiagramRequest(newContext(), present);

    expect(ui.terminals).toHaveLength(0);
    expect(ui.clipboard).toBe("");
    expect(ui.infos).toHaveLength(0);
  });

  it("never runs twf-diagram itself — the request is all it produces", async () => {
    answerEverything();

    await newDiagramRequest(newContext(), present);

    expect(ui.executed).toEqual([]);
    expect(ui.terminals[0]!.sent[0]!.startsWith("claude '")).toBe(true);
  });
});

describe("finding the project and the script", () => {
  it("remembers the last project and offers it first", async () => {
    const context = newContext();
    answerEverything();
    ui.quickPicks[0] = "Browse…";
    ui.folder = "/home/mpb/src/another";

    await newDiagramRequest(context, present);
    expect(ui.terminals[0]!.cwd).toBe("/home/mpb/src/another");

    ui.reset();
    answerEverything();
    ui.quickPicks[0] = "/home/mpb/src/another";

    await newDiagramRequest(context, present);
    expect(ui.offered[0]).toEqual(["/home/mpb/src/another", REPO, "Browse…"]);
  });

  it("finds twf-diagram in an open workspace folder, with no setting at all", async () => {
    // A real twowayflow checkout open beside the project being diagrammed: the common case.
    const checkout = mkdtempSync(join(tmpdir(), "twf-checkout-"));
    mkdirSync(join(checkout, "scripts"));
    writeFileSync(join(checkout, "scripts", "twf-diagram"), "#!/bin/sh\n");

    settings.delete("twowayflow.diagramRequest.scriptPath");
    workspace.workspaceFolders = [{ uri: { fsPath: checkout, path: checkout } }];
    answerEverything();
    ui.quickPicks[0] = "Browse…";
    ui.folder = REPO;

    await newDiagramRequest(newContext(), present);

    expect(harness.warnings).toHaveLength(0);
    expect(ui.terminals[0]!.sent[0]!).toContain(join(checkout, "scripts", "twf-diagram"));
  });

  it("warns, and names the script relatively, when no open folder has a copy of it", async () => {
    const empty = mkdtempSync(join(tmpdir(), "twf-empty-"));

    settings.delete("twowayflow.diagramRequest.scriptPath");
    workspace.workspaceFolders = [{ uri: { fsPath: empty, path: empty } }];
    answerEverything();
    ui.quickPicks[0] = "Browse…";
    ui.folder = REPO;

    await newDiagramRequest(newContext(), present);

    expect(harness.warnings[0]).toContain("scripts/twf-diagram");
    expect(ui.terminals[0]!.sent[0]!).toContain("use scripts/twf-diagram to branch");
  });
});
