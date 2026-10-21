import type { NodeProps } from "@xyflow/react";
import { Handle, Position } from "@xyflow/react";
import type { ReactElement } from "react";

export interface FlowNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly kind: string;
  readonly nodeId: string;
  /** The node's `description` option, when the file gives one. */
  readonly description?: string;
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
  // The tooltip is a sibling of the node body rather than a `title` attribute: the native one
  // waits a second, cannot wrap a paragraph, and ignores the editor's theme.
  const tipId = `twf-tip-${node.nodeId}`;
  const described = node.description !== undefined && node.description !== "";
  return (
    <div
      className={`twf-node twf-kind-${node.kind}${selected ? " twf-selected" : ""}${
        node.inSync ? " twf-insync" : ""
      }`}
      {...(described ? { "aria-describedby": tipId } : {})}
    >
      <Handle type="target" position={Position.Left} />
      <span className="twf-glyph">{KIND_GLYPH[node.kind] ?? "ƒ"}</span>
      <span className="twf-label">{node.label}</span>
      <span className="twf-kindtag">{node.kind}</span>
      {described ? (
        <span className="twf-tip" id={tipId} role="tooltip">
          {node.description}
        </span>
      ) : undefined}
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
