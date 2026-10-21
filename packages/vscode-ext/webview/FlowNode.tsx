import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { ReactElement } from "react";

export interface FlowNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly kind: string;
  readonly nodeId: string;
  readonly inSync: boolean;
}

const KIND_GLYPH: Record<string, string> = {
  source: "▶",
  transform: "ƒ",
  filter: "⌗",
  fanout: "⑂",
  join: "⋈",
  sink: "■",
  unknown: "?",
};

export function FlowNodeView({ data, selected }: NodeProps): ReactElement {
  const node = data as FlowNodeData;
  return (
    <div
      className={`twf-node twf-kind-${node.kind}${selected ? " twf-selected" : ""}${
        node.inSync ? " twf-insync" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <span className="twf-glyph">{KIND_GLYPH[node.kind] ?? "ƒ"}</span>
      <span className="twf-label">{node.label}</span>
      <span className="twf-kindtag">{node.kind}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/** A chain link twowayflow could not read. Shown so the user can see it, never patched. */
export function UnknownNodeView({ data }: NodeProps): ReactElement {
  const payload = data as { text: string; reason: string };
  return (
    <div className="twf-node twf-unknown" title={`Not understood: ${payload.reason}`}>
      <span className="twf-glyph">?</span>
      <code className="twf-label">{payload.text}</code>
      <span className="twf-kindtag">{payload.reason}</span>
    </div>
  );
}
