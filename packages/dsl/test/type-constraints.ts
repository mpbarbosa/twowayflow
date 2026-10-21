/**
 * Compile-time assertions. There is no runtime here: `pnpm typecheck` is the test. Each
 * `@ts-expect-error` fails the build if the error it claims stops happening, so this file
 * guards the type-level guarantees described in docs/dsl.md §4.
 */
import { flow } from "../src/index.js";

// An edge may only reference node ids that have already been declared.
flow("f")
  .node("a", { kind: "source" })
  // @ts-expect-error - "b" was never declared
  .edge("a", "b");

// Both endpoints are checked.
flow("f")
  .node("a", { kind: "source" })
  .node("b", { kind: "sink" })
  // @ts-expect-error - "c" was never declared
  .edge("c", "b");

// Declaring the same id twice is an error.
flow("f")
  .node("a", { kind: "source" })
  // @ts-expect-error - duplicate node id
  .node("a", { kind: "sink" });

// `kind` is restricted to the known vocabulary.
flow("f")
  // @ts-expect-error - "frobnicate" is not a NodeKind
  .node("a", { kind: "frobnicate" });

// A valid flow must still typecheck.
export const valid = flow("f")
  .node("a", { kind: "source", at: [0, 0] })
  .node("b", { kind: "sink", at: [240, 0] })
  .edge("a", "b")
  .toSpec();
