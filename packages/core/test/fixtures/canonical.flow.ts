import { flow } from "@twowayflow/dsl";

export default flow("canonical")
  .node("a", { kind: "source", at: [0, 0] })
  .node("b", { kind: "transform", at: [240, 0] })
  .node("c", { kind: "sink", at: [480, 0] })
  .edge("a", "b")
  .edge("b", "c");
