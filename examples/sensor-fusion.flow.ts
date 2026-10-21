import { flow } from "@twowayflow/dsl";

/**
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ Name         sensor-fusion                                                                  │
 * │ Type         Flow graph — acyclic (one fan-in, one fan-out)                                 │
 * │ Project      twowayflow                                                                     │
 * │ Description  Lidar at 10Hz and camera at 30Hz fan in to a join, and the calibrated result   │
 * │              fans back out to a tracker, a recorder and a dashboard. Also carries the one   │
 * │              node with no `at:`, and a `description` on every node, so the auto-layout,     │
 * │              first-drag and hover paths are all exercised.                                  │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * A genuine DAG rather than a chain: two independent sources fan in to a join, and the result
 * fans back out to three consumers.
 *
 * This is the example that rules out "edges inferred from nesting" (docs/dsl.md §3) — with
 * nesting, `calibrate` having three consumers cannot be written at all without naming
 * intermediates, which is just declared edges wearing a hat.
 *
 * It is also the example that carries a `description` on every node: the prose the canvas
 * renders on hover, which the parser has to read out of the option object and the patcher has
 * to leave alone when a node moves.
 */
export default flow("sensor-fusion")
  .node("lidar", {
    kind: "source",
    at: [0, 0],
    description: "Raw point clouds off the spinning lidar, one sweep per revolution at 10Hz.",
    params: { hz: 10 },
  })
  .node("camera", {
    kind: "source",
    at: [0, 180],
    description: "The forward camera at 30Hz, three frames for every lidar sweep.",
    params: { hz: 30 },
  })
  .node("resample", {
    kind: "transform",
    at: [240, 180],
    label: "resample to 10Hz",
    description:
      "Drops every third frame so the camera arrives on the lidar's clock; the one lossy step in the graph.",
  })
  .node("fuse", {
    kind: "join",
    at: [480, 90],
    description:
      "Pairs each sweep with the frame nearest it in time and emits one combined observation.",
  })
  // A node with no `at`: the canvas auto-lays it out, and writes an `at` the first time
  // someone drags it. This is the "no position yet" case the patcher has to handle.
  .node("calibrate", {
    kind: "transform",
    description:
      "Applies the extrinsics so points and pixels share one frame of reference. The node with no `at:`.",
  })
  .node("fanout", {
    kind: "fanout",
    at: [960, 90],
    description:
      "Hands the same calibrated observation to three consumers that run at their own pace.",
  })
  .node("tracker", {
    kind: "sink",
    at: [1200, 0],
    label: "object tracker",
    description:
      "Keeps per-object state across observations; the only consumer that can fall behind.",
  })
  .node("recorder", {
    kind: "sink",
    at: [1200, 120],
    description: "Writes every observation to disk unchanged, so a run can be replayed offline.",
  })
  .node("dashboard", {
    kind: "sink",
    at: [1200, 240],
    description:
      "Draws the latest observation for a human watching; drops anything it cannot keep up with.",
  })
  .edge("lidar", "fuse", { label: "points" })
  .edge("camera", "resample")
  .edge("resample", "fuse", { label: "frames" })
  .edge("fuse", "calibrate")
  .edge("calibrate", "fanout")
  .edge("fanout", "tracker")
  .edge("fanout", "recorder")
  .edge("fanout", "dashboard");
