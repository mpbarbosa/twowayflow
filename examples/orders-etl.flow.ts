import { flow } from "@twowayflow/dsl";

/**
 * A plain linear ETL pipeline: read a CSV, clean it, write it to a database.
 *
 * Everything the canvas touches is on the surface — `kind`, `at`, and the two string ids in
 * each `.edge(...)`. The `params` and `run` properties below are opaque payload: drag a node
 * in the canvas and they must come out byte-for-byte identical.
 */
export default flow("orders-etl")
  .node("readCsv", {
    kind: "source",
    at: [0, 120],
    params: { path: "./data/orders.csv", encoding: "utf8" },
  })
  .node("parseRows", {
    kind: "transform",
    at: [274, 214],
    // Inline code is the whole point of an embedded DSL: this is real, type-checked,
    // refactorable TypeScript, not a string in a config file.
    run: (rows: string[]) => rows.map((row) => row.split(",")),
  })
  .node("dropIncomplete", { kind: "filter", at: [520, 120], label: "drop incomplete" })
  .node("writeDb", {
    kind: "sink",
    at: [780, 120],
    params: { table: "orders", onConflict: "update" },
  })
  .edge("readCsv", "parseRows", { label: "lines" })
  .edge("parseRows", "dropIncomplete", { label: "rows" })
  .edge("dropIncomplete", "writeDb");
