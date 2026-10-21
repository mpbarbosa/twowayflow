import type { NodeKind, Position } from "@twowayflow/dsl";
import { NODE_KINDS } from "@twowayflow/dsl";
import fc from "fast-check";
import type { FlowGraphSpec, FlowOp } from "../src/index.js";

// --------------------------------------------------------------------------------------------
// Graphs
// --------------------------------------------------------------------------------------------

/** Ids drawn from the alphabet the DSL can round-trip without escapes. */
const arbId = fc
  .tuple(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
    fc.stringMatching(/^[A-Za-z0-9_$]{0,7}$/),
  )
  .map(([head, tail]) => head + tail);

const arbKind: fc.Arbitrary<NodeKind> = fc.constantFrom(...NODE_KINDS);

const arbPosition: fc.Arbitrary<Position> = fc.record({
  x: fc.integer({ min: -2000, max: 4000 }),
  y: fc.integer({ min: -2000, max: 4000 }),
});

/** A label, including ones with spaces, unicode and punctuation the literal must survive. */
const arbLabel = fc.oneof(
  fc.stringMatching(/^[A-Za-z0-9 _.,:;!?()[\]{}<>+=*&%#@~^|-]{1,24}$/),
  fc.constantFrom("mesure de débit", "行数", "a'b", "100% / 2", "-- dash --"),
);

export const arbGraph: fc.Arbitrary<FlowGraphSpec> = fc
  .record({
    name: arbId,
    nodes: fc.uniqueArray(
      fc.record(
        {
          id: arbId,
          kind: arbKind,
          label: arbLabel,
          position: arbPosition,
        },
        { requiredKeys: ["id"] },
      ),
      { minLength: 1, maxLength: 6, selector: (n) => n.id },
    ),
    edgeSeeds: fc.array(
      fc.record({
        from: fc.nat({ max: 20 }),
        to: fc.nat({ max: 20 }),
        label: fc.option(arbLabel, { nil: undefined }),
      }),
      { maxLength: 8 },
    ),
  })
  .map(({ name, nodes, edgeSeeds }) => ({
    name,
    nodes,
    edges: edgeSeeds.map((seed) => ({
      from: nodes[seed.from % nodes.length]!.id,
      to: nodes[seed.to % nodes.length]!.id,
      ...(seed.label === undefined ? {} : { label: seed.label }),
    })),
  }));

// --------------------------------------------------------------------------------------------
// Rendering a graph as deliberately awkward source
// --------------------------------------------------------------------------------------------

/**
 * Gap text between one link's `)` and the next link's `.`.
 *
 * Every entry is syntactically legal in that position, and several carry comments, because the
 * whole point is that the parser's spans must exclude trivia and the patcher must not disturb
 * it. `%` is replaced by the link index so each comment is distinguishable.
 */
const GAPS = [
  "\n  ",
  "\n\t",
  "\n        ",
  "\n\n  ",
  " ",
  "",
  "\n  // note %\n  ",
  "\n  /* block % */\n  ",
  " /* inline % */ ",
  "\n  // one %\n  // two %\n  ",
] as const;

/** Ways to write the same options object. */
const OPTION_STYLES = [
  "canonical",
  "tight",
  "spaced-trailing-comma",
  "multiline",
  "reordered",
  "extra-opaque-keys",
  "none-if-empty",
] as const;

type OptionStyle = (typeof OPTION_STYLES)[number];

export interface RenderStyle {
  readonly header: string;
  readonly gapChoices: readonly number[];
  readonly nodeStyles: readonly OptionStyle[];
  readonly edgeStyles: readonly number[];
  readonly unparsableAfter: readonly number[];
  readonly trailingNewlines: number;
}

export const arbRenderStyle: fc.Arbitrary<RenderStyle> = fc.record({
  header: fc.constantFrom(
    "",
    "// A file-level note.\n",
    "/* Block header.\n   Second line. */\n",
    "\n\n",
  ),
  gapChoices: fc.array(fc.nat({ max: GAPS.length - 1 }), { minLength: 24, maxLength: 24 }),
  nodeStyles: fc.array(fc.constantFrom(...OPTION_STYLES), { minLength: 8, maxLength: 8 }),
  edgeStyles: fc.array(fc.nat({ max: 2 }), { minLength: 10, maxLength: 10 }),
  unparsableAfter: fc.uniqueArray(fc.nat({ max: 7 }), { maxLength: 2 }),
  trailingNewlines: fc.nat({ max: 2 }),
});

function literal(value: string): string {
  return `"${value}"`;
}

function renderOptions(
  style: OptionStyle,
  entries: readonly [string, string][],
  index: number,
): string {
  if (entries.length === 0) return style === "none-if-empty" ? "" : ", {}";

  const ordered = style === "reordered" ? [...entries].reverse() : entries;
  const all =
    style === "extra-opaque-keys"
      ? [...ordered, ["params", `{ n: ${index}, deep: { s: "x" } }`] as [string, string]]
      : ordered;

  switch (style) {
    case "tight":
      return `,{${all.map(([k, v]) => `${k}:${v}`).join(",")}}`;
    case "spaced-trailing-comma":
      return `, {  ${all.map(([k, v]) => `${k} :  ${v}`).join(" ,  ")} ,  }`;
    case "multiline":
      return `, {\n${all.map(([k, v]) => `    ${k}: ${v},`).join("\n")}\n  }`;
    default:
      return `, { ${all.map(([k, v]) => `${k}: ${v}`).join(", ")} }`;
  }
}

/** A chain link the parser is required to refuse, to sit beside the valid ones. */
const UNPARSABLE_LINKS = [
  '.node(dynamicId, { kind: "transform" })',
  // A template literal is exactly what the parser has to refuse here, so the generated source
  // genuinely needs the `${...}` in it.
  // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional, see above
  ".node(`templated${dynamicId}`, {})",
  '.stage("notAMethod", { at: [0, 0] })',
  '.node("pre" + dynamicId, { kind: "sink" })',
] as const;

export interface Rendered {
  readonly source: string;
  readonly unparsableCount: number;
}

/**
 * Render a graph as source, pushing awkwardness through every seam the parser has: gap trivia,
 * option-object formatting, argument spacing, and links it must refuse outright.
 */
export function renderFlow(spec: FlowGraphSpec, style: RenderStyle): Rendered {
  const gap = (index: number) => {
    const text = GAPS[style.gapChoices[index % style.gapChoices.length]! % GAPS.length]!;
    return text.replaceAll("%", String(index));
  };

  const links: string[] = [];

  spec.nodes.forEach((node, i) => {
    const entries: [string, string][] = [];
    if (node.kind !== undefined) entries.push(["kind", literal(node.kind)]);
    if (node.position !== undefined) {
      entries.push(["at", `[${node.position.x}, ${node.position.y}]`]);
    }
    if (node.label !== undefined) entries.push(["label", literal(node.label)]);
    const optionStyle = style.nodeStyles[i % style.nodeStyles.length]!;
    links.push(`.node(${literal(node.id)}${renderOptions(optionStyle, entries, i)})`);
  });

  spec.edges.forEach((edge, i) => {
    const variant = style.edgeStyles[i % style.edgeStyles.length]!;
    const options = edge.label === undefined ? "" : `, { label: ${literal(edge.label)} }`;
    if (variant === 0) {
      links.push(`.edge(${literal(edge.from)}, ${literal(edge.to)}${options})`);
    } else if (variant === 1) {
      links.push(`.edge( ${literal(edge.from)} , ${literal(edge.to)} ${options} )`);
    } else {
      // Tight spacing, but only outside the string literals: squeezing spaces out of a label
      // would change the graph, not just its formatting.
      const tight = edge.label === undefined ? "" : `,{label:${literal(edge.label)}}`;
      links.push(`.edge(${literal(edge.from)},${literal(edge.to)}${tight})`);
    }
  });

  let unparsableCount = 0;
  for (const [offset, at] of [...style.unparsableAfter].sort((a, b) => b - a).entries()) {
    if (links.length === 0) break;
    const index = at % (links.length + 1);
    links.splice(index, 0, UNPARSABLE_LINKS[(at + offset) % UNPARSABLE_LINKS.length]!);
    unparsableCount += 1;
  }

  const needsDynamicId = unparsableCount > 0;
  const preamble =
    `import { flow } from "@twowayflow/dsl";\n\n` +
    (needsDynamicId ? 'const dynamicId = "computed";\n\n' : "") +
    style.header;

  const chain = links.map((link, i) => gap(i) + link).join("");
  const source = `${preamble}export default flow(${literal(spec.name ?? "untitled")})${chain};${"\n".repeat(style.trailingNewlines + 1)}`;

  return { source, unparsableCount };
}

// --------------------------------------------------------------------------------------------
// Operation intents
// --------------------------------------------------------------------------------------------

/**
 * An abstract operation, resolved against whatever graph is current when it is applied.
 *
 * Generating concrete ops up front would not survive a sequence, because op 3 has to target a
 * graph that ops 1 and 2 already changed. Indices are taken modulo the current size, and an
 * intent that cannot apply is skipped.
 */
export type OpIntent =
  | {
      readonly t: "addNode";
      readonly id: string;
      readonly kind: NodeKind;
      readonly position: Position;
    }
  | { readonly t: "addNodeNoPosition"; readonly id: string; readonly kind: NodeKind }
  | { readonly t: "deleteNode"; readonly which: number }
  | { readonly t: "renameNode"; readonly which: number; readonly newId: string }
  | { readonly t: "moveNode"; readonly which: number; readonly position: Position }
  | { readonly t: "addEdge"; readonly fromWhich: number; readonly toWhich: number }
  | { readonly t: "deleteEdge"; readonly which: number };

export const arbOpIntent: fc.Arbitrary<OpIntent> = fc.oneof(
  fc.record({
    t: fc.constant("addNode" as const),
    id: arbId,
    kind: arbKind,
    position: arbPosition,
  }),
  fc.record({ t: fc.constant("addNodeNoPosition" as const), id: arbId, kind: arbKind }),
  fc.record({ t: fc.constant("deleteNode" as const), which: fc.nat({ max: 20 }) }),
  fc.record({ t: fc.constant("renameNode" as const), which: fc.nat({ max: 20 }), newId: arbId }),
  fc.record({
    t: fc.constant("moveNode" as const),
    which: fc.nat({ max: 20 }),
    position: arbPosition,
  }),
  fc.record({
    t: fc.constant("addEdge" as const),
    fromWhich: fc.nat({ max: 20 }),
    toWhich: fc.nat({ max: 20 }),
  }),
  fc.record({ t: fc.constant("deleteEdge" as const), which: fc.nat({ max: 20 }) }),
);

/** Resolve an intent against the current graph, or return undefined if it cannot apply. */
export function resolveIntent(
  intent: OpIntent,
  spec: FlowGraphSpec,
  edgeIdList: readonly string[],
): FlowOp | undefined {
  const nodeIds = spec.nodes.map((n) => n.id);

  switch (intent.t) {
    case "addNode":
      if (nodeIds.includes(intent.id)) return undefined;
      return { op: "addNode", id: intent.id, kind: intent.kind, position: intent.position };
    case "addNodeNoPosition":
      if (nodeIds.includes(intent.id)) return undefined;
      return { op: "addNode", id: intent.id, kind: intent.kind };
    case "deleteNode":
      if (nodeIds.length === 0) return undefined;
      return { op: "deleteNode", id: nodeIds[intent.which % nodeIds.length]! };
    case "renameNode": {
      if (nodeIds.length === 0) return undefined;
      const id = nodeIds[intent.which % nodeIds.length]!;
      if (intent.newId !== id && nodeIds.includes(intent.newId)) return undefined;
      return { op: "renameNode", id, newId: intent.newId };
    }
    case "moveNode":
      if (nodeIds.length === 0) return undefined;
      return {
        op: "moveNode",
        id: nodeIds[intent.which % nodeIds.length]!,
        position: intent.position,
      };
    case "addEdge":
      if (nodeIds.length === 0) return undefined;
      return {
        op: "addEdge",
        from: nodeIds[intent.fromWhich % nodeIds.length]!,
        to: nodeIds[intent.toWhich % nodeIds.length]!,
      };
    case "deleteEdge":
      if (edgeIdList.length === 0) return undefined;
      return { op: "deleteEdge", edgeId: edgeIdList[intent.which % edgeIdList.length]! };
  }
}
