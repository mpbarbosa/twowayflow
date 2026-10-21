import { flow } from "@twowayflow/dsl";

/**
 * A genuine DAG rather than a chain: two independent sources fan in to a join, and the result
 * fans back out to three consumers.
 *
 * This is the example that rules out "edges inferred from nesting" (docs/dsl.md §3) — with
 * nesting, `calibrate` having three consumers cannot be written at all without naming
 * intermediates, which is just declared edges wearing a hat.
 */
export default flow("sensor-fusion")
  .node("lidar", { kind: "source", at: [0, 0], params: { hz: 10 } })
  .node("camera", { kind: "source", at: [0, 180], params: { hz: 30 } })
  .node("resample", { kind: "transform", at: [240, 180], label: "resample to 10Hz" })
  .node("fuse", { kind: "join", at: [480, 90] })
  // A node with no `at`: the canvas auto-lays it out, and writes an `at` the first time
  // someone drags it. This is the "no position yet" case the patcher has to handle.
  .node("calibrate", { kind: "transform" })
  .node("fanout", { kind: "fanout", at: [960, 90] })
  .node("tracker", { kind: "sink", at: [1200, 0], label: "object tracker" })
  .node("recorder", { kind: "sink", at: [1200, 120] })
  .node("dashboard", { kind: "sink", at: [1200, 240] })
  .edge("lidar", "fuse", { label: "points" })
  .edge("camera", "resample")
  .edge("resample", "fuse", { label: "frames" })
  .edge("fuse", "calibrate")
  .edge("calibrate", "fanout")
  .edge("fanout", "tracker")
  .edge("fanout", "recorder")
  .edge("fanout", "dashboard");
