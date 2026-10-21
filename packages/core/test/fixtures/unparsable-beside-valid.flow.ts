import { flow } from "@twowayflow/dsl";

const dynamicId = "computed";
const suffix = "2";

/**
 * Four of these links twowayflow cannot read. It must still show the three it can, and a patch
 * must leave the four alone byte-for-byte.
 */
export default flow("mixed")
  .node("valid1", { kind: "source", at: [0, 0] })
  // id is a variable, not a literal
  .node(dynamicId, { kind: "transform", at: [240, 0] })
  // id is a template literal
  .node(`templated${suffix}`, { kind: "transform", at: [240, 120] })
  .node("valid2", { kind: "transform", at: [480, 0] })
  // a method the DSL does not have
  .stage("whatIsThis", { at: [480, 120] })
  // an id built by concatenation
  .node("pre" + suffix, { kind: "sink" })
  .node("valid3", { kind: "sink", at: [720, 0] })
  .edge("valid1", "valid2")
  .edge("valid2", "valid3");
