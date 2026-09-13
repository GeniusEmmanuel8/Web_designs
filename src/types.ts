import type { Edge, Node } from "@xyflow/react";

export type DecisionStatus = "starter" | "suggested" | "chosen" | "ghost" | "affected";
export type RelationType = "flows_to" | "supports" | "requires" | "unlocks" | "affects" | "conflicts";

export type DecisionOption = {
  id: string;
  label: string;
  detail: string;
  recommended?: boolean;
};

export type DecisionImpact = {
  latencyMs: number;
  monthlyCost: number;
  strain: number;
};

export type DecisionCandidate = {
  id: string;
  label: string;
  subtitle: string;
  pro: string;
  con: string;
  why?: string;
  downstream?: string;
  impact?: DecisionImpact;
  conflictsWith?: Record<string, string>;
};

export type DecisionStage = {
  id: string;
  title: string;
  options: DecisionCandidate[];
};

export type DecisionBlueprint = {
  id: string;
  name: string;
  purpose: string;
  description?: string;
  dependsOn?: string[];
  stages: DecisionStage[];
};

export type DecisionNodeData = Record<string, unknown> & {
  label: string;
  title: string;
  subtitle: string;
  pro: string;
  con: string;
  why?: string;
  downstream?: string;
  impact?: DecisionImpact;
  description: string;
  groupId: string;
  groupTitle?: string;
  status: DecisionStatus;
  options: DecisionOption[];
  selectedOptionId?: string;
  isStarter?: boolean;
  conflictsWith?: Record<string, string>;
};

export type DecisionEdgeData = Record<string, unknown> & {
  relation: RelationType;
  rationale: string;
  isOverride?: boolean;
  origin?: "route" | "ai" | "user";
  validationStatus?: "pending" | "validated" | "fallback";
};

export type DecisionNode = Node<DecisionNodeData, "decision">;
export type DecisionEdge = Edge<DecisionEdgeData, "relation">;

export type DecisionGraph = {
  id: string;
  name: string;
  purpose: string;
  description?: string;
  dependsOn: string[];
  stages: DecisionStage[];
  nodes: DecisionNode[];
  edges: DecisionEdge[];
};

export type BriefSection = {
  id: string;
  title: string;
  body: string;
};

export type WebbedProject = {
  id: string;
  title: string;
  idea: string;
  model: string;
  graphs: DecisionGraph[];
  brief: BriefSection[];
};
