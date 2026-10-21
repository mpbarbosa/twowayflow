import { flow } from "@twowayflow/dsl";

// Half-typed, exactly as it looks a third of a second after someone starts a new node.
export default flow("half-typed")
  .node("done", { kind: "source", at: [0, 0] })
  .node("inProgress", { kind: "trans
  .edge("done", "inProgress")
