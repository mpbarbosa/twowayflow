import {
  addEdge as _addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  MarkerType,
  MiniMap,
  type Node,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasGraph } from "../src/protocol.js";
import { FlowNodeView, UnknownNodeView } from "./FlowNode.jsx";
import { onMessage, send } from "./vscode.js";

const NODE_TYPES = { flowNode: FlowNodeView, unknownNode: UnknownNodeView };

function toReactFlow(
  graph: CanvasGraph,
  cursorNodeId: string | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "flowNode",
    position: node.position ?? { x: 0, y: 0 },
    data: {
      label: node.label ?? node.id,
      kind: node.kind ?? "transform",
      nodeId: node.id,
      ...(node.description === undefined ? {} : { description: node.description }),
      inSync: node.id === cursorNodeId,
    },
  }));

  // Unknown links are laid out below the graph; they have no position in the source.
  graph.unknown.forEach((unknown, i) => {
    nodes.push({
      id: unknown.id,
      type: "unknownNode",
      position: { x: i * 320, y: -200 },
      draggable: false,
      connectable: false,
      data: { text: unknown.text, reason: unknown.reason },
    });
  });

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    ...(edge.label === undefined ? {} : { label: edge.label }),
    markerEnd: { type: MarkerType.ArrowClosed },
  }));

  return { nodes, edges };
}

function CanvasInner(): ReactElement {
  const [graph, setGraph] = useState<CanvasGraph | undefined>();
  const [cursorNodeId, setCursorNodeId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const { screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = onMessage((message) => {
      if (message.type === "graph") {
        setGraph(message.graph);
        setError(undefined);
      } else if (message.type === "reveal") {
        setCursorNodeId(message.nodeId);
      } else if (message.type === "error") {
        setError(message.message);
      }
    });
    send({ type: "ready" });
    return off;
  }, []);

  const { nodes, edges } = useMemo(
    () => (graph ? toReactFlow(graph, cursorNodeId) : { nodes: [], edges: [] }),
    [graph, cursorNodeId],
  );

  /**
   * Node changes are *not* applied to local state.
   *
   * The canvas has no model of its own: it renders whatever the last parse said. A drag ends,
   * the extension patches the file, the file re-parses, and the new position arrives as a new
   * graph. Keeping a local copy here is exactly the mistake that makes round-trip tools lose
   * hand edits, so the only thing this handler does is report selection.
   */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const change of changes) {
      if (change.type === "select" && change.selected) {
        send({
          type: "selectNode",
          nodeId: change.id.startsWith("unknown:") ? undefined : change.id,
        });
      }
    }
  }, []);

  const onNodeDragStop = useCallback((_event: unknown, node: Node) => {
    if (node.id.startsWith("unknown:")) return;
    send({
      type: "moveNode",
      nodeId: node.id,
      position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
    });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    send({ type: "addEdge", from: connection.source, to: connection.target });
  }, []);

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    for (const edge of deleted) send({ type: "deleteEdge", edgeId: edge.id });
  }, []);

  const onNodesDelete = useCallback((deleted: Node[]) => {
    for (const node of deleted) {
      if (!node.id.startsWith("unknown:")) send({ type: "deleteNode", nodeId: node.id });
    }
  }, []);

  const onNodeDoubleClick = useCallback((_event: unknown, node: Node) => {
    if (node.id.startsWith("unknown:")) return;
    const next = window.prompt("Rename node", node.id);
    if (next && next !== node.id) send({ type: "renameNode", nodeId: node.id, newId: next });
  }, []);

  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      send({
        type: "addNode",
        position: { x: Math.round(position.x), y: Math.round(position.y) },
      });
    },
    [screenToFlowPosition],
  );

  /** Keyboard-reachable equivalent of double-clicking the canvas. */
  const onAddNodeAtCentre = useCallback(() => {
    const box = wrapper.current?.getBoundingClientRect();
    const centre = box
      ? screenToFlowPosition({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
      : { x: 0, y: 0 };
    send({ type: "addNode", position: { x: Math.round(centre.x), y: Math.round(centre.y) } });
  }, [screenToFlowPosition]);

  const problems = graph?.diagnostics.filter((d) => d.severity === "error") ?? [];

  return (
    <div className="twf-root" ref={wrapper}>
      <header className="twf-bar">
        <strong>{graph?.name ?? "no flow in this file"}</strong>
        <span className="twf-counts">
          {graph ? `${graph.nodes.length} nodes · ${graph.edges.length} edges` : "parsing…"}
          {graph && graph.unknown.length > 0 ? ` · ${graph.unknown.length} not understood` : ""}
        </span>
        <button type="button" className="twf-add" onClick={onAddNodeAtCentre}>
          + Add node
        </button>
        <span className="twf-hint">
          drag a node to move it in the file · double-click the canvas to add · double-click a node
          to rename
        </span>
      </header>

      {error ? <div className="twf-error">{error}</div> : undefined}
      {problems.length > 0 ? (
        <div className="twf-error">
          {problems.length} syntax error{problems.length === 1 ? "" : "s"} in this file — the canvas
          shows what could still be read.
        </div>
      ) : undefined}

      {/* `application` is the right role for a pan/zoom canvas: it tells assistive tech that
          this subtree handles its own keys. The accessible way to add a node is the button
          above; double-click is the shortcut. */}
      <div
        className="twf-canvas"
        role="application"
        aria-label="Flow canvas"
        onDoubleClick={onPaneDoubleClick}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onNodesDelete={onNodesDelete}
          onNodeDoubleClick={onNodeDoubleClick}
          fitView
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

export function Canvas(): ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}

export { _addEdge };
