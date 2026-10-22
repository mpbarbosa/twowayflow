/**
 * The words half of asking for a diagram: what the wizard collected becomes the one request
 * that leaves nothing to guess, plus the shell command that delivers it.
 *
 * Nothing here imports `vscode`, because this is the part that has to be right and so has to be
 * testable without an extension host: every `twf-diagram` argument has to appear in the
 * sentence, and the quoting has to survive a real shell.
 *
 * The judgement stays where it was — which notation, what claim the diagram carries, whether it
 * is worth drawing. This only stops you retyping the ritual around it.
 */
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/** A notation the wizard offers. */
export interface Notation {
  /** How the request reads: "Draw a <phrase> of ...". */
  readonly phrase: string;
  /** What reaches `twf-diagram --type`, and so the titleblock's Type row, verbatim. */
  readonly type: string;
}

/**
 * The offered notations. `type` is prose, not an enum — the script takes any string — so these
 * are a starting point you can talk Claude out of, not a closed set. The class and object rows
 * match the two diagrams already in `docs/twowayflow/`, so a second one of either reads the same.
 */
export const NOTATIONS: readonly Notation[] = [
  { phrase: "sequence diagram (Mermaid)", type: "Sequence diagram — Mermaid" },
  {
    phrase: "UML class diagram",
    type: "UML class diagram — static structure, extracted from source",
  },
  {
    phrase: "UML object diagram",
    type: "UML object diagram — one runtime snapshot, extracted from source",
  },
  { phrase: "state diagram (Mermaid)", type: "State diagram — Mermaid" },
  { phrase: "flowchart (Mermaid)", type: "Flowchart — Mermaid" },
  {
    phrase: "entity-relationship diagram (Mermaid)",
    type: "Entity-relationship diagram — Mermaid",
  },
  { phrase: "C4 container diagram", type: "C4 container diagram — Mermaid" },
  { phrase: "dataflow diagram", type: "Dataflow diagram — Mermaid" },
  { phrase: "deployment topology diagram", type: "Topology diagram — Mermaid" },
];

export interface DiagramRequest {
  /** The project the diagram describes — an absolute path, since the terminal may start elsewhere. */
  readonly repo: string;
  /** What the diagram shows: "POST /api/perguntar", "the parse/patch core". */
  readonly subject: string;
  readonly notation: Notation;
  /** Becomes the branch, the file name and the index link, so it is validated here too. */
  readonly slug: string;
  readonly title: string;
  /** The titleblock description. Empty means: Claude writes it from what it drew. */
  readonly description: string;
  /** Path to `twf-diagram`. Absolute where we could find it, because cwd is the other project. */
  readonly script: string;
  readonly pr: boolean;
}

/**
 * `check_slug` in the script refuses anything but letters, digits, dot, dash and underscore, and
 * anything starting with a dot. Refusing it here too means the wizard fails at the input box
 * rather than three steps later, in a shell.
 */
export function validateSlug(slug: string): string | undefined {
  if (slug === "") return "a slug is required: it becomes the branch, the file and the index link";
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(slug)) {
    return "letters, digits, dot, dash or underscore only, and not starting with a dot";
  }
  return undefined;
}

/**
 * The request. One sentence, shaped like the one you would type, naming every argument the
 * script needs — then the description, or the instruction to write one.
 */
export function buildRequest(request: DiagramRequest): string {
  const landing = request.pr
    ? "to branch and land it, and open the PR"
    : "to branch and land it, without opening a PR";
  const sentence =
    `Draw a ${request.notation.phrase} of ${request.subject} in ${request.repo}, ` +
    `slug ${request.slug}, titled "${request.title}", type "${request.notation.type}" — ` +
    `use ${request.script} ${landing}, with the title as the commit subject.`;
  const description = request.description
    ? `The titleblock description: ${request.description}`
    : "Write the titleblock description yourself, from what the diagram ends up showing and what it is read off.";
  return `${sentence}\n\n${description}`;
}

/** Single quotes, the one quoting a POSIX shell does not reinterpret. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function terminalCommand(request: string, binary = "claude"): string {
  return `${binary} ${shellQuote(request)}`;
}

/**
 * Whether a binary is runnable, so the terminal handoff can fall back to the clipboard instead
 * of sending a line to a shell that will answer "command not found". `pathVar` is a parameter
 * because that is the whole of what this depends on, and tests say so explicitly.
 */
export function onPath(binary: string, pathVar = process.env.PATH ?? ""): boolean {
  const names =
    process.platform === "win32" ? [binary, `${binary}.cmd`, `${binary}.exe`] : [binary];
  for (const dir of pathVar.split(delimiter)) {
    if (dir === "") continue;
    for (const name of names) {
      try {
        accessSync(join(dir, name), constants.X_OK);
        return true;
      } catch {
        // Not there, or not executable. Try the next name, then the next directory.
      }
    }
  }
  return false;
}
