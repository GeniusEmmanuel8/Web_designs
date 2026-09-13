import type { DecisionEdge, DecisionGraph, DecisionNode } from "../types";

export function rebuildRoutes(graph: DecisionGraph): DecisionGraph {
  const active = graph.stages.flatMap((stage) => {
    const node = graph.nodes.find((item) => item.data.groupId === stage.id && item.data.status === "chosen");
    return node ? [node] : [];
  });
  const activeIds = new Set(active.map((node) => node.id));
  const manual = graph.edges.filter((edge) => edge.data?.origin !== "route"
    && activeIds.has(edge.source) && activeIds.has(edge.target));
  const routes = active.slice(0, -1).flatMap((source, index): DecisionEdge[] => {
    const target = active[index + 1];
    if (manual.some((edge) => edge.source === source.id || edge.target === target.id)) return [];
    const conflict = source.data.conflictsWith?.[target.id] ?? target.data.conflictsWith?.[source.id];
    return [{
      id: `route-${source.id}-${target.id}`, source: source.id, target: target.id,
      type: "relation", animated: !conflict,
      data: { relation: conflict ? "conflicts" : "flows_to", origin: "route",
        rationale: conflict ?? "This is the currently selected decision path." },
    }];
  });
  return { ...graph, edges: [...manual, ...routes] };
}

export function chooseNode(graph: DecisionGraph, nodeId: string): DecisionGraph {
  const selected = graph.nodes.find((node) => node.id === nodeId);
  if (!selected) return graph;
  return rebuildRoutes({ ...graph, nodes: graph.nodes.map((node) => node.data.groupId === selected.data.groupId
    ? { ...node, data: { ...node.data, status: node.id === nodeId ? "chosen" : "ghost" } } : node) });
}

export function connectRoute(graph: DecisionGraph, edge: DecisionEdge, replacedId?: string): DecisionGraph {
  const selected = chooseNode(chooseNode(graph, edge.source), edge.target);
  return rebuildRoutes({ ...selected, edges: [
    ...selected.edges.filter((item) => item.id !== replacedId && item.source !== edge.source && item.target !== edge.target),
    edge,
  ] });
}

export function insertStep(graph: DecisionGraph, afterNodeId: string, nodeId: string): DecisionGraph {
  const source = graph.nodes.find((node) => node.id === afterNodeId);
  if (!source) return graph;
  const index = graph.stages.findIndex((stage) => stage.id === source.data.groupId);
  if (index < 0) return graph;
  const nextStageId = graph.stages[index + 1]?.id;
  const stageId = `stage-${nodeId}`;
  const option = { id: nodeId, label: "New decision", subtitle: "Describe what this step produces.",
    pro: "", con: "" };
  const stages = [...graph.stages];
  stages.splice(index + 1, 0, { id: stageId, title: "New step", options: [option] });
  const node: DecisionNode = { id: nodeId, type: "decision", position: { x: 0, y: source.position.y },
    data: { ...option, title: option.label, description: option.subtitle,
      groupId: stageId, groupTitle: "New step", status: "chosen", options: [], isStarter: false } };
  // Remove the bypass across the split, including manually rewired sibling connections.
  const edges = graph.edges.filter((edge) => {
    const from = graph.nodes.find((item) => item.id === edge.source);
    const to = graph.nodes.find((item) => item.id === edge.target);
    return !(from?.data.groupId === source.data.groupId && to?.data.groupId === nextStageId);
  });
  return rebuildRoutes({ ...graph, stages, edges, nodes: [...graph.nodes, node].map((item) => ({
    ...item, position: { x: stages.findIndex((stage) => stage.id === item.data.groupId) * 290, y: item.position.y },
  })) });
}

export function removeNodes(graph: DecisionGraph, ids: Set<string>): DecisionGraph {
  const nodes = graph.nodes.filter((node) => !ids.has(node.id));
  const stages = graph.stages.filter((stage) => nodes.some((node) => node.data.groupId === stage.id))
    .map((stage) => ({ ...stage, options: stage.options.filter((option) => !ids.has(option.id)) }));
  for (const stage of stages) {
    const siblings = nodes.filter((node) => node.data.groupId === stage.id);
    if (!siblings.some((node) => node.data.status === "chosen")) {
      const index = nodes.findIndex((node) => node.id === siblings[0].id);
      nodes[index] = { ...nodes[index], data: { ...nodes[index].data, status: "chosen" } };
    }
  }
  return rebuildRoutes({ ...graph, stages, nodes: nodes.map((node) => ({ ...node,
    data: { ...node.data, isStarter: node.data.groupId === stages[0]?.id },
    position: { x: stages.findIndex((stage) => stage.id === node.data.groupId) * 290, y: node.position.y },
  })) });
}
