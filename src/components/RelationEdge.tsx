import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  type EdgeProps,
} from "@xyflow/react";
import type { DecisionEdge, RelationType } from "../types";

const relationColors: Record<RelationType, string> = {
  flows_to: "#8b5cf6",
  supports: "#7c3aed",
  requires: "#4f46e5",
  unlocks: "#8b5cf6",
  affects: "#0f9ca8",
  conflicts: "#f5b700",
};

export function RelationEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  data,
  selected,
}: EdgeProps<DecisionEdge>) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const relation = data?.relation ?? "supports";
  const pending = data?.validationStatus === "pending";
  const color = pending ? "#94a3b8" : relationColors[relation];

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
      markerEnd={markerEnd}
      interactionWidth={22}
      className={data?.origin === "route" && relation !== "conflicts" ? "relation-edge--route" : undefined}
      style={{
          stroke: color,
          strokeWidth: relation === "conflicts" || selected ? 3 : 2,
          strokeDasharray: pending ? "4 5" : relation === "affects" ? "7 6" : undefined,
          filter: relation === "conflicts" ? "drop-shadow(0 0 5px rgba(245,183,0,.55))" : undefined,
        }}
      />
      {(selected || relation === "conflicts" || pending) && (
        <EdgeLabelRenderer>
          <div
            className={`edge-label ${pending ? "edge-label--pending" : `edge-label--${relation}`}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {pending ? "checking" : relation.replace("_", " ")}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
