import { flow } from "@twowayflow/dsl";

// Three edges between the same pair. The first is identified positionally, as `fanIn->merge`;
// the other two declare their identity, which is what keeps all three stable when one of them
// is deleted. See docs/dsl.md §1.
export default flow("parallel-edges")
  .node("fanIn", { kind: "fanout", at: [0, 0] })
  .node("merge", { kind: "join", at: [240, 0] })
  .edge("fanIn", "merge", { label: "default route" })
  .edge("fanIn", "merge", { id: "fast-path", label: "cached" })
  .edge("fanIn", "merge", { id: "slow-path", label: "recomputed" });
