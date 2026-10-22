/**
 * The request itself.
 *
 * `twf-diagram` fails late and in a shell: a slug it refuses, a `--type` it never got, a title
 * swallowed by quoting. So the sentence is tested for naming every argument the script needs,
 * the slug rule is tested against the same cases `check_slug` refuses, and the quoting is tested
 * by running it through a real shell rather than by reading it.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRequest,
  type DiagramRequest,
  NOTATIONS,
  onPath,
  shellQuote,
  terminalCommand,
  validateSlug,
} from "../src/diagramRequest.js";

const BASE: DiagramRequest = {
  repo: "/home/mpb/src/pessoabot",
  subject: "POST /api/perguntar",
  notation: { phrase: "sequence diagram (Mermaid)", type: "Sequence diagram — Mermaid" },
  slug: "turno-sequencia",
  title: "One turn in time",
  description: "One turn of POST /api/perguntar in time: the lock, and the guard that runs late.",
  script: "/home/mpb/src/twowayflow/scripts/twf-diagram",
  pr: true,
};

describe("the request", () => {
  it("names every argument twf-diagram needs", () => {
    const request = buildRequest(BASE);

    // Each of these is an argument the script would otherwise have to be guessed at.
    expect(request).toContain("/home/mpb/src/pessoabot");
    expect(request).toContain("turno-sequencia");
    expect(request).toContain('"One turn in time"');
    expect(request).toContain('"Sequence diagram — Mermaid"');
    expect(request).toContain("/home/mpb/src/twowayflow/scripts/twf-diagram");
    expect(request).toContain("POST /api/perguntar");
    expect(request).toContain(BASE.description);
  });

  it("reads as the sentence you would have typed", () => {
    expect(buildRequest(BASE).split("\n")[0]).toBe(
      "Draw a sequence diagram (Mermaid) of POST /api/perguntar in /home/mpb/src/pessoabot, " +
        'slug turno-sequencia, titled "One turn in time", type "Sequence diagram — Mermaid" — ' +
        "use /home/mpb/src/twowayflow/scripts/twf-diagram to branch and land it, and open the " +
        "PR, with the title as the commit subject.",
    );
  });

  it("says so when no PR is wanted", () => {
    const request = buildRequest({ ...BASE, pr: false });
    expect(request).toContain("without opening a PR");
    expect(request).not.toContain("and open the PR");
  });

  it("hands the description over when it was left empty", () => {
    const request = buildRequest({ ...BASE, description: "" });
    expect(request).toContain("Write the titleblock description yourself");
    // And never leaves the field dangling, which is what the lint refuses later.
    expect(request).not.toContain("The titleblock description:");
  });

  it("offers notations with a distinct phrase and Type row each", () => {
    for (const notation of NOTATIONS) {
      expect(notation.phrase).not.toBe("");
      expect(notation.type).not.toBe("");
    }
    expect(new Set(NOTATIONS.map((n) => n.phrase)).size).toBe(NOTATIONS.length);
    expect(new Set(NOTATIONS.map((n) => n.type)).size).toBe(NOTATIONS.length);
  });
});

describe("the slug", () => {
  it("accepts what check_slug accepts", () => {
    for (const slug of ["turno-sequencia", "a", "v1.2_x", "UML-01"]) {
      expect(validateSlug(slug), slug).toBeUndefined();
    }
  });

  it("refuses what check_slug refuses", () => {
    // Empty, dot-leading, and anything outside [a-zA-Z0-9._-] — a path separator above all.
    for (const slug of ["", ".hidden", "..", "has space", "a/b", "quote'd", "x;rm -rf"]) {
      expect(validateSlug(slug), slug).toBeTypeOf("string");
    }
  });
});

describe("the terminal command", () => {
  it.skipIf(process.platform === "win32")("survives a real shell intact", () => {
    const request = buildRequest({
      ...BASE,
      title: "O turno d'água",
      subject: 'POST /api/perguntar; echo "pwned" $(id) `whoami`',
    });

    // Exactly the command the terminal would run, with `printf` standing in for `claude`, so
    // what comes back is what `claude` would have been handed as its argument.
    const out = execFileSync("sh", ["-c", terminalCommand(request, "printf %s")], {
      encoding: "utf8",
    });

    expect(out).toBe(request);
  });

  it("quotes by single quotes, apostrophes included", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(terminalCommand("hi", "claude")).toBe("claude 'hi'");
  });
});

describe("onPath", () => {
  it("finds an executable in one of the PATH entries, and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "twf-path-"));
    const binary = join(dir, "claude");
    writeFileSync(binary, "#!/bin/sh\n");
    chmodSync(binary, 0o755);

    expect(onPath("claude", [join(dir, "nope"), dir].join(delimiter))).toBe(true);
    expect(onPath("claude", join(dir, "nope"))).toBe(false);
    expect(onPath("not-claude", dir)).toBe(false);
    // An empty PATH must not be read as "the current directory".
    expect(onPath("claude", "")).toBe(false);
  });
});
