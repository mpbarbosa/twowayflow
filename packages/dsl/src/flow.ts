import type { EdgeOptions, EdgeSpec, FlowSpec, NodeOptions, NodeSpec } from "./types.js";

/**
 * The chained builder. `Ids` accumulates the string-literal union of node ids declared so far,
 * so `.edge()` can only reference nodes that already exist — which is what turns a dangling
 * edge into a compile error. See docs/dsl.md §4.
 */
export interface FlowBuilder<Ids extends string = never> {
  readonly name: string;

  node<Id extends string>(
    id: Id extends Ids ? DuplicateNodeId<Id> : Id,
    options?: NodeOptions,
  ): FlowBuilder<Ids | Id>;

  edge(from: Ids, to: Ids, options?: EdgeOptions): FlowBuilder<Ids>;

  /** Materialise the flow as plain data. */
  toSpec(): FlowSpec;
}

/**
 * Shows up in the error message when a node id is declared twice, instead of the much less
 * helpful "Argument of type 'x' is not assignable to type 'never'".
 */
type DuplicateNodeId<Id extends string> = `error: node id ${Id} is already declared`;

const CANVAS_KEYS = new Set(["kind", "at", "label"]);

function toNodeSpec(id: string, options: NodeOptions | undefined): NodeSpec {
  const opts = options ?? {};
  const at = opts.at;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (!CANVAS_KEYS.has(key)) rest[key] = value;
  }
  return {
    id,
    ...(opts.kind === undefined ? {} : { kind: opts.kind }),
    ...(opts.label === undefined ? {} : { label: opts.label }),
    ...(at === undefined ? {} : { position: { x: at[0], y: at[1] } }),
    options: rest,
  };
}

function build(name: string, nodes: NodeSpec[], edges: EdgeSpec[]): FlowBuilder<string> {
  const builder: FlowBuilder<string> = {
    name,
    node(id, options) {
      return build(name, [...nodes, toNodeSpec(id as string, options)], edges);
    },
    edge(from, to, options) {
      const edge: EdgeSpec = {
        from,
        to,
        ...(options?.id === undefined ? {} : { id: options.id }),
        ...(options?.label === undefined ? {} : { label: options.label }),
      };
      return build(name, nodes, [...edges, edge]);
    },
    toSpec() {
      return { name, nodes: [...nodes], edges: [...edges] };
    },
  };
  return builder;
}

/**
 * Start a flow. The returned builder is immutable: every `.node()` / `.edge()` returns a new
 * one, so a `*.flow.ts` file is a single expression with no hidden mutation to reason about.
 */
export function flow(name: string): FlowBuilder {
  // The runtime builder is id-agnostic; the `Ids` parameter exists only to accumulate declared
  // ids at the type level, so the public signature starts it at `never`.
  return build(name, [], []) as unknown as FlowBuilder;
}
