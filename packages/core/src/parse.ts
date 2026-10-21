import { NODE_KINDS, type NodeKind } from "@twowayflow/dsl";
import type { Node, Parser } from "web-tree-sitter";
import { getParser, type LanguageOptions } from "./language.js";
import type {
  ChainLink,
  Diagnostic,
  FlowEdge,
  FlowFile,
  FlowNode,
  Span,
  UnknownLink,
  UnparsableReason,
} from "./model.js";

const KINDS = new Set<string>(NODE_KINDS);

/** Convenience wrapper that initialises tree-sitter on first use. */
export async function parseFlowSource(
  source: string,
  options?: LanguageOptions,
): Promise<FlowFile> {
  const parser = await getParser(options);
  return parseFlowSourceWith(parser, source);
}

/** Parse with an already-initialised parser. The extension host reuses one across keystrokes. */
export function parseFlowSourceWith(parser: Parser, source: string): FlowFile {
  const tree = parser.parse(source);
  if (!tree) {
    return {
      source,
      nodes: [],
      edges: [],
      unknownLinks: [],
      diagnostics: [
        {
          code: "syntax-error",
          severity: "error",
          message: "tree-sitter returned no tree",
          span: { start: 0, end: source.length },
        },
      ],
    };
  }

  try {
    return buildFlowFile(source, tree.rootNode);
  } finally {
    tree.delete();
  }
}

function buildFlowFile(source: string, root: Node): FlowFile {
  const diagnostics: Diagnostic[] = [];
  collectSyntaxErrors(root, diagnostics);

  const rootCall = findFlowRootCall(root);
  if (!rootCall) {
    diagnostics.push({
      code: "no-flow-chain",
      severity: "warning",
      message: 'No `flow("...")` call found in this file.',
      span: { start: 0, end: Math.min(source.length, 1) },
    });
    return { source, nodes: [], edges: [], unknownLinks: [], diagnostics };
  }

  const nameArg = firstArgument(rootCall);
  const nameLiteral = nameArg ? plainStringSpan(nameArg) : undefined;

  const links = walkChain(source, rootCall);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const unknownLinks: UnknownLink[] = [];
  const edgeIdCounts = new Map<string, number>();

  for (const { link, call, optional } of links) {
    if (optional) {
      pushUnknown(unknownLinks, diagnostics, link, "optional-chain", source);
      continue;
    }
    const args = callArguments(call);

    if (link.method === "node") {
      const parsed = parseNodeLink(link, args);
      if ("reason" in parsed) pushUnknown(unknownLinks, diagnostics, link, parsed.reason, source);
      else nodes.push(parsed.node);
      continue;
    }

    if (link.method === "edge") {
      const parsed = parseEdgeLink(link, args, edgeIdCounts);
      if ("reason" in parsed) pushUnknown(unknownLinks, diagnostics, link, parsed.reason, source);
      else edges.push(parsed.edge);
      continue;
    }

    pushUnknown(unknownLinks, diagnostics, link, "unknown-method", source);
  }

  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      diagnostics.push({
        code: "duplicate-node-id",
        severity: "error",
        message: `Node id "${node.id}" is declared more than once.`,
        span: node.idSpan,
      });
    }
    seen.add(node.id);
  }

  for (const edge of edges) {
    for (const [end, id, span] of [
      ["from", edge.from, edge.fromSpan],
      ["to", edge.to, edge.toSpan],
    ] as const) {
      if (!seen.has(id)) {
        diagnostics.push({
          code: "dangling-edge",
          severity: "warning",
          message: `Edge ${end} references undeclared node "${id}".`,
          span,
        });
      }
    }
  }

  const chainEnd = links.length > 0 ? links[links.length - 1]!.link.span.end : rootCall.endIndex;

  return {
    source,
    ...(nameLiteral ? { name: nameLiteral.value, nameSpan: nameLiteral.span } : {}),
    chainSpan: { start: rootCall.startIndex, end: chainEnd },
    rootCallSpan: { start: rootCall.startIndex, end: rootCall.endIndex },
    nodes,
    edges,
    unknownLinks,
    diagnostics,
  };
}

function pushUnknown(
  unknownLinks: UnknownLink[],
  diagnostics: Diagnostic[],
  link: ChainLink,
  reason: UnparsableReason,
  source: string,
): void {
  unknownLinks.push({ link, reason });
  diagnostics.push({
    code: "unparsable-link",
    severity: "warning",
    message:
      `twowayflow cannot read \`${source.slice(link.span.start, Math.min(link.span.end, link.span.start + 60))}\` ` +
      `(${reason}); it will be shown as opaque and left untouched by edits.`,
    span: link.span,
  });
}

function collectSyntaxErrors(root: Node, diagnostics: Diagnostic[]): void {
  if (!root.hasError) return;
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.isError || node.isMissing) {
      diagnostics.push({
        code: "syntax-error",
        severity: "error",
        message: node.isMissing ? `Missing ${node.type}` : "Syntax error",
        span: { start: node.startIndex, end: node.endIndex },
      });
      continue;
    }
    if (!node.hasError) continue;
    for (const child of node.children) if (child) stack.push(child);
  }
}

/**
 * Find the innermost `flow(...)` call that starts a builder chain.
 *
 * "Innermost" because the chain nests left-recursively: `flow("x").node(...).edge(...)` parses
 * as `call(member(call(member(call(flow, "x"))))) `, so the *first* link in reading order is
 * the *deepest* call expression. We locate that one and climb outwards.
 */
function findFlowRootCall(root: Node): Node | undefined {
  for (const call of root.descendantsOfType("call_expression")) {
    const callee = call.childForFieldName("function");
    if (callee?.type === "identifier" && callee.text === "flow") return call;
  }
  return undefined;
}

interface ChainStep {
  readonly link: ChainLink;
  readonly call: Node;
  readonly optional: boolean;
}

/** Climb from the root `flow(...)` call outwards, yielding links in source order. */
function walkChain(source: string, rootCall: Node): ChainStep[] {
  const steps: ChainStep[] = [];
  let current = rootCall;

  for (;;) {
    const member = current.parent;
    if (member?.type !== "member_expression") break;
    if (!member.childForFieldName("object")?.equals(current)) break;

    const call = member.parent;
    if (call?.type !== "call_expression") break;
    if (!call.childForFieldName("function")?.equals(member)) break;

    const property = member.childForFieldName("property");
    if (!property) break;

    // `?.` makes the link conditional; we refuse to patch those rather than guess.
    const optional = member.children.some((c) => c?.type === "optional_chain");
    const dot = source.lastIndexOf(".", property.startIndex);
    const start = dot === -1 ? property.startIndex : dot;

    steps.push({
      link: {
        method: property.text,
        span: { start, end: call.endIndex },
        leadingTriviaStart: current.endIndex,
        index: steps.length,
      },
      call,
      optional,
    });

    current = call;
  }

  return steps;
}

function callArguments(call: Node): Node[] {
  const args = call.childForFieldName("arguments");
  if (!args) return [];
  // `comment` is a named node in tree-sitter-typescript, and a comment can appear between
  // arguments, so it has to be filtered out before indexing positionally.
  return args.namedChildren.filter((child): child is Node => !!child && child.type !== "comment");
}

function firstArgument(call: Node): Node | undefined {
  return callArguments(call)[0];
}

/**
 * The span *between* the quotes of a plain double- or single-quoted string literal, plus its
 * value. Returns undefined for anything the patcher must not rewrite blind: template literals,
 * concatenations, identifiers, and strings containing escape sequences.
 */
function plainStringSpan(node: Node): { value: string; span: Span } | undefined {
  if (node.type !== "string") return undefined;
  const inner = node.namedChildren.filter((c): c is Node => !!c);
  if (inner.some((c) => c.type !== "string_fragment")) return undefined;
  if (inner.length === 0) {
    // An empty literal: `""`. Span is the zero-width point between the quotes.
    const point = node.startIndex + 1;
    return { value: "", span: { start: point, end: point } };
  }
  if (inner.length > 1) return undefined;
  const fragment = inner[0]!;
  return {
    value: fragment.text,
    span: { start: fragment.startIndex, end: fragment.endIndex },
  };
}

function objectArgument(node: Node | undefined): Node | undefined {
  return node?.type === "object" ? node : undefined;
}

/** Look up a property of an object literal by key, accepting `key:` and `"key":`. */
function objectProperty(object: Node, key: string): Node | undefined {
  for (const child of object.namedChildren) {
    if (child?.type !== "pair") continue;
    const keyNode = child.childForFieldName("key");
    if (!keyNode) continue;
    const keyText =
      keyNode.type === "property_identifier"
        ? keyNode.text
        : keyNode.type === "string"
          ? plainStringSpan(keyNode)?.value
          : undefined;
    if (keyText === key) return child.childForFieldName("value") ?? undefined;
  }
  return undefined;
}

function numberLiteral(node: Node | undefined): number | undefined {
  if (!node) return undefined;
  if (node.type === "number") {
    const value = Number(node.text);
    return Number.isFinite(value) ? value : undefined;
  }
  // `at: [-40, 0]` — a negative coordinate is a unary expression, not a number literal.
  if (node.type === "unary_expression" && node.children[0]?.type === "-") {
    const operand = numberLiteral(node.childForFieldName("argument") ?? undefined);
    return operand === undefined ? undefined : -operand;
  }
  return undefined;
}

function positionLiteral(node: Node | undefined): { x: number; y: number; span: Span } | undefined {
  if (node?.type !== "array") return undefined;
  const items = node.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
  if (items.length !== 2) return undefined;
  const x = numberLiteral(items[0]);
  const y = numberLiteral(items[1]);
  if (x === undefined || y === undefined) return undefined;
  return { x, y, span: { start: node.startIndex, end: node.endIndex } };
}

function stringProperty(object: Node | undefined, key: string): string | undefined {
  if (!object) return undefined;
  const value = objectProperty(object, key);
  if (!value) return undefined;
  return plainStringSpan(value)?.value;
}

function parseNodeLink(
  link: ChainLink,
  args: readonly Node[],
): { node: FlowNode } | { reason: UnparsableReason } {
  if (args.length === 0 || args.length > 2) return { reason: "bad-arity" };

  const id = plainStringSpan(args[0]!);
  if (!id) return { reason: "non-literal-id" };
  if (id.value === "") return { reason: "empty-id" };

  const options = objectArgument(args[1]);
  if (args.length === 2 && !options) return { reason: "bad-arity" };

  const kindText = stringProperty(options, "kind");
  const label = stringProperty(options, "label");
  const position = options ? positionLiteral(objectProperty(options, "at")) : undefined;

  return {
    node: {
      id: id.value,
      idSpan: id.span,
      ...(kindText !== undefined && KINDS.has(kindText) ? { kind: kindText as NodeKind } : {}),
      ...(label === undefined ? {} : { label }),
      ...(position
        ? { position: { x: position.x, y: position.y }, positionSpan: position.span }
        : {}),
      ...(options ? { optionsSpan: { start: options.startIndex, end: options.endIndex } } : {}),
      link,
    },
  };
}

function parseEdgeLink(
  link: ChainLink,
  args: readonly Node[],
  counts: Map<string, number>,
): { edge: FlowEdge } | { reason: UnparsableReason } {
  if (args.length < 2 || args.length > 3) return { reason: "bad-arity" };

  const from = plainStringSpan(args[0]!);
  const to = plainStringSpan(args[1]!);
  if (!from || !to) return { reason: "non-literal-id" };
  if (from.value === "" || to.value === "") return { reason: "empty-id" };

  const options = objectArgument(args[2]);
  if (args.length === 3 && !options) return { reason: "bad-arity" };

  const label = stringProperty(options, "label");
  const base = `${from.value}->${to.value}`;
  const seen = counts.get(base) ?? 0;
  counts.set(base, seen + 1);

  return {
    edge: {
      id: seen === 0 ? base : `${base}#${seen}`,
      from: from.value,
      fromSpan: from.span,
      to: to.value,
      toSpan: to.span,
      ...(label === undefined ? {} : { label }),
      ...(options ? { optionsSpan: { start: options.startIndex, end: options.endIndex } } : {}),
      link,
    },
  };
}
