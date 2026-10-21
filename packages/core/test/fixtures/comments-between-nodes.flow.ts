import { flow } from "@twowayflow/dsl";

// A whole-file note that must survive everything.
export default flow("commented")
  // reads from the upstream feed
  .node("ingest", { kind: "source", at: [0, 0] })
  /* block comment between links,
     spanning several lines */
  .node("clean", { kind: "transform", at: [240, 0] }) // trailing note on the clean node
  .node("store", { kind: "sink", at: [480, 0] })
  // the two edges below are load bearing
  .edge("ingest", "clean")
  .edge("clean", "store"); // and a note after the semicolon
