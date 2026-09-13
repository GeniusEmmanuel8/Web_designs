import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check } from "lucide-react";
import type { DecisionNode } from "../types";

export function DecisionNodeView({ data, selected }: NodeProps<DecisionNode>) {
  const chosen = data.status === "chosen";

  return (
    <article
      className={`decision-card decision-card--${data.status} ${data.isStarter ? "decision-card--starter" : ""} ${selected ? "is-selected" : ""}`}
      aria-label={`${data.title}: ${data.subtitle}`}
    >
      <Handle className="decision-handle decision-handle--input" type="target" position={Position.Left} />

      <header className="decision-card__header">
        <span className="decision-card__eyebrow">
          {chosen && <Check size={11} strokeWidth={3} />}
          {chosen ? "Active" : "Alternative"}
        </span>
        <h3>{data.title}</h3>
        <p>{data.subtitle}</p>
      </header>

      <Handle className="decision-handle decision-handle--output" type="source" position={Position.Right} />
    </article>
  );
}
