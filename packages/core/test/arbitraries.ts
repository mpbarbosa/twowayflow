import type { NodeKind, Position } from "@twowayflow/dsl";
import { NODE_KINDS } from "@twowayflow/dsl";
import fc from "fast-check";
import { type FlowGraphSpec, type FlowOp, suggestEdgeId } from "../src/index.js";

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

/**
 * A declared edge id. Drawn from an alphabet with no `->` in it, and including a few awkward
 * ones, because a declared id is a free-form string literal rather than an identifier.
 */
const arbEdgeId = fc.oneof(
  arbId.map((id) => `e_${id}`),
  fc.constantFrom("fast-path", "slow path", "ligação directa", "100%"),
);

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

const arbGraphShape = fc.record({
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
      // Half the seeds ask for an id. Most files in the wild will declare none, so the corpus
      // has to keep plenty of fully-undeclared graphs to hold backward compatibility honest.
      id: fc.option(arbEdgeId, { nil: undefined, freq: 2 }),
    }),
    { maxLength: 8 },
  ),
});

function graphFrom(declareParallel: boolean) {
  return arbGraphShape.map(({ name, nodes, edgeSeeds }) => ({
    name,
    nodes,
    edges: resolveEdgeSeeds(
      edgeSeeds.map((seed) => ({
        from: nodes[seed.from % nodes.length]!.id,
        to: nodes[seed.to % nodes.length]!.id,
        ...(seed.label === undefined ? {} : { label: seed.label }),
        ...(seed.id === undefined ? {} : { id: seed.id }),
      })),
      declareParallel,
    ),
  }));
}

/**
 * Any legal flow file, including ones no canvas would have written.
 *
 * In particular it generates pairs with two or more *undeclared* parallel edges, whose identity
 * is still positional and therefore still renumbers when one of them is deleted. That is a real
 * shape a person can type, so the parser and every single-operation property have to cope with
 * it.
 */
export const arbGraph: fc.Arbitrary<FlowGraphSpec> = graphFrom(false);

/**
 * A flow file in which every edge's identity is stable: at most one undeclared edge per pair.
 *
 * This is the invariant the canvas maintains — `suggestEdgeId` declares an id on every parallel
 * edge it creates — and it is the precondition for the two properties that need identity to mean
 * the same thing before and after an edit: identity stability under deletion, and batches
 * containing more than one edge-deleting op. Positional identity cannot satisfy either, which is
 * exactly why declared ids exist.
 */
export const arbStableGraph: fc.Arbitrary<FlowGraphSpec> = graphFrom(true);

type SeededEdge = {
  readonly from: string;
  readonly to: string;
  readonly id?: string;
  readonly label?: string;
};

/**
 * Settle which generated edges declare an id, and make sure no two edges share one.
 *
 * `declareParallel` decides the first question. When it is set, only the first edge of a pair may
 * go undeclared — any later one is given an id, the way the canvas would. When it is not, every
 * seed that did not ask for an id keeps a positional identity, however many siblings it has.
 *
 * Either way no two edges may resolve to the same id, or `deleteEdge` would be ambiguous and the
 * parser would rightly complain. Positional ids are worked out first and declared ids are pushed
 * aside until they stop colliding with them.
 */
function resolveEdgeSeeds(seeds: readonly SeededEdge[], declareParallel: boolean): SeededEdge[] {
  const pairOf = (e: SeededEdge) => `${e.from}->${e.to}`;

  // Pass 1: who is positional, and which ids does that reserve?
  const positionalIds = new Set<string>();
  const counts = new Map<string, number>();
  const isPositional = seeds.map((seed) => {
    const pair = pairOf(seed);
    if (seed.id !== undefined) return false;
    if (declareParallel && counts.has(pair)) return false;
    const seen = counts.get(pair) ?? 0;
    counts.set(pair, seen + 1);
    positionalIds.add(seen === 0 ? pair : `${pair}#${seen}`);
    return true;
  });

  // Pass 2: hand out declared ids, avoiding every id already spoken for.
  const taken = new Set(positionalIds);
  return seeds.map((seed, i) => {
    if (isPositional[i]) return seed;
    let id = seed.id ?? `${pairOf(seed)}#${i}`;
    while (taken.has(id)) id = `${id}_`;
    taken.add(id);
    return { ...seed, id };
  });
}

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
  edgeStyles: fc.array(fc.nat({ max: 3 }), { minLength: 10, maxLength: 10 }),
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
  // A computed edge id is refused too: the patcher will not guess which edge it names.
  '.edge("from", "to", { id: dynamicId })',
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
    const entries: [string, string][] = [];
    if (edge.id !== undefined) entries.push(["id", literal(edge.id)]);
    if (edge.label !== undefined) entries.push(["label", literal(edge.label)]);
    // Variant 3 writes the same keys in the opposite order, so `label` can precede `id`.
    const ordered = variant === 3 ? [...entries].reverse() : entries;
    const object = (body: string) => (ordered.length === 0 ? "" : `, ${body}`);
    const from = literal(edge.from);
    const to = literal(edge.to);

    if (variant === 1) {
      const loose = `{  ${ordered.map(([k, v]) => `${k} :  ${v}`).join(" ,  ")} ,  }`;
      links.push(`.edge( ${from} , ${to} ${object(loose)} )`);
    } else if (variant === 2) {
      // Tight spacing, but only outside the string literals: squeezing spaces out of a label
      // would change the graph, not just its formatting.
      const tight = `{${ordered.map(([k, v]) => `${k}:${v}`).join(",")}}`;
      links.push(`.edge(${from},${to}${object(tight)})`);
    } else {
      const canonical = `{ ${ordered.map(([k, v]) => `${k}: ${v}`).join(", ")} }`;
      links.push(`.edge(${from}, ${to}${object(canonical)})`);
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
  | {
      readonly t: "addEdge";
      readonly fromWhich: number;
      readonly toWhich: number;
      /** A caller-chosen id. When absent, the one the canvas would choose is used instead. */
      readonly id?: string;
    }
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
    // Usually left to the canvas's own rule, which is the path the extension actually takes.
    id: fc.option(arbEdgeId, { nil: undefined, freq: 4 }),
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
    case "addEdge": {
      if (nodeIds.length === 0) return undefined;
      const from = nodeIds[intent.fromWhich % nodeIds.length]!;
      const to = nodeIds[intent.toWhich % nodeIds.length]!;
      // Either the generator names the edge, or the canvas's own rule does: declare an id when
      // this would be a parallel edge, and nothing when `from->to` already identifies it.
      const id = intent.id ?? suggestEdgeId(spec.edges, from, to);
      if (id !== undefined && edgeIdList.includes(id)) return undefined;
      return { op: "addEdge", from, to, ...(id === undefined ? {} : { id }) };
    }
    case "deleteEdge":
      if (edgeIdList.length === 0) return undefined;
      return { op: "deleteEdge", edgeId: edgeIdList[intent.which % edgeIdList.length]! };
  }
}
