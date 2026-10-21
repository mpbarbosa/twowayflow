import { flow } from "@twowayflow/dsl";

interface Row {
  readonly sku: string;
  readonly qty: number;
}

export default flow("opaque")
  .node("read", {
    kind: "source",
    at: [0, 0],
    params: { path: "./in.csv", quote: '"', delimiter: "\t" },
  })
  .node("tidy", {
    // `at` deliberately comes after a closure, so an edit to it must not disturb the closure.
    kind: "transform",
    run: (rows: Row[]) =>
      rows
        .filter((row) => row.qty > 0)
        .map((row) => ({ ...row, sku: row.sku.trim().toUpperCase() })),
    retries: 3,
    at: [240, 0],
  })
  .node("noOptions")
  .node("emptyOptions", {})
  .node("noPosition", { kind: "sink" })
  .edge("read", "tidy")
  .edge("tidy", "noOptions");
