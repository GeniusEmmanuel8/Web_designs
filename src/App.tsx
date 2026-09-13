import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  Activity,
  AlertTriangle,
  Check,
  Clipboard,
  CircleDollarSign,
  Download,
  FileJson,
  Gauge,
  History,
  Moon,
  Network,
  Plus,
  Sparkles,
  Sun,
  WandSparkles,
  X,
} from "lucide-react";
import { DecisionNodeView } from "./components/DecisionNode";
import { FlowWebBackground } from "./components/FlowWebBackground";
import { Inspector } from "./components/Inspector";
import { RelationEdgeView } from "./components/RelationEdge";
import { WebBackground } from "./components/WebBackground";
import { generateBlueprint, generateBrief, titleFromIdea } from "./data/blueprintGenerator";
import { graphFromBlueprint, seedProject } from "./data/seed";
import { createHandoff } from "./data/handoff";
import { chooseNode, connectRoute, insertStep, removeNodes } from "./data/routing";
import type { BriefSection, DecisionBlueprint, DecisionEdge, DecisionGraph, DecisionImpact, DecisionNode, RelationType, WebbedProject } from "./types";

const nodeTypes = { decision: DecisionNodeView };
const edgeTypes = { relation: RelationEdgeView };
const defaultGraphNames = ["Product Design", "Technical Build", "Pitch & Scope"];
const geminiModelIds = {
  "Gemini 3.5 Flash-Lite": "gemini-3.5-flash-lite",
  "Gemini 3.5 Flash": "gemini-3.5-flash",
} as const;
const ollamaModelIds = {
  "Ollama: gpt-oss:20b-cloud": "gpt-oss:20b-cloud",
  "Ollama: llama3.1:8b": "llama3.1:8b",
  "Ollama: gemma3:4b": "gemma3:4b",
} as const;

const cloneProject = (): WebbedProject => structuredClone(seedProject);

type GeneratedBlueprint = Pick<DecisionBlueprint, "purpose" | "stages">;
type RouteAssessment = DecisionImpact & { rationale: string; routeKey: string; model: string; provider: string };
type RoutePathItem = { stage: string; choice: string; detail: string };
type ProjectRoute = { name: string; decisions: RoutePathItem[] };
type GeneratedBrief = { signature: string; sections: BriefSection[] };
type EdgeEndpoint = RoutePathItem & { id: string };
type EdgeClassification = { relation: Exclude<RelationType, "flows_to">; rationale: string; provider?: string };
type IntegrationKey = "backboard";
type GraphDraft = { name: string; description: string };
type IntegrationStatus = Record<IntegrationKey, { configured: boolean; purpose: string }>;
type SavedWorkspace = {
  project: WebbedProject;
  generatedBrief?: GeneratedBrief;
  reviewGraphIds: string[];
  backboardThreadId?: string;
  savedAt: string;
};

const workspaceStorageKey = "webbed-workspace-v1";
const emptyIntegrationStatus: IntegrationStatus = {
  backboard: { configured: false, purpose: "Decision memory" },
};

function loadSavedWorkspace(): SavedWorkspace | undefined {
  try {
    const value = localStorage.getItem(workspaceStorageKey);
    if (!value) return undefined;
    const parsed = JSON.parse(value) as Partial<SavedWorkspace>;
    if (!parsed.project?.id || !Array.isArray(parsed.project.graphs) || parsed.project.graphs.length === 0) return undefined;
    return {
      project: parsed.project,
      generatedBrief: parsed.generatedBrief,
      reviewGraphIds: Array.isArray(parsed.reviewGraphIds) ? parsed.reviewGraphIds : [],
      backboardThreadId: typeof parsed.backboardThreadId === "string" ? parsed.backboardThreadId : undefined,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

function downloadText(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameFromTitle(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "webbed-project";
}

function downstreamGraphIds(graphs: DecisionGraph[], graphId: string) {
  const affected = new Set<string>();
  const queue = [graphId];
  while (queue.length > 0) {
    const upstreamId = queue.shift();
    if (!upstreamId) continue;
    graphs.filter((graph) => graph.dependsOn.includes(upstreamId)).forEach((graph) => {
      if (affected.has(graph.id)) return;
      affected.add(graph.id);
      queue.push(graph.id);
    });
  }
  return [...affected];
}

async function requestGeminiBlueprint(idea: string, graphName: string, selectedModel: string, graphDescription = ""): Promise<GeneratedBlueprint> {
  const model = geminiModelIds[selectedModel as keyof typeof geminiModelIds] ?? geminiModelIds["Gemini 3.5 Flash-Lite"];
  const response = await fetch("/api/blueprints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea, graphNames: [graphName], graphDescription, model }),
  });
  const payload = await response.json() as { blueprints?: GeneratedBlueprint[]; error?: string };
  const blueprint = payload.blueprints?.[0];
  if (!response.ok || !blueprint) throw new Error(payload.error ?? "Gemini did not return a blueprint.");
  return blueprint;
}

async function requestOllamaBlueprint(idea: string, graphName: string, selectedModel: string, graphDescription = ""): Promise<GeneratedBlueprint> {
  const model = ollamaModelIds[selectedModel as keyof typeof ollamaModelIds] ?? ollamaModelIds["Ollama: gpt-oss:20b-cloud"];
  const response = await fetch("/api/ollama/blueprints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea, graphNames: [graphName], graphDescription, model }),
  });
  const payload = await response.json() as { blueprints?: GeneratedBlueprint[]; error?: string };
  const blueprint = payload.blueprints?.[0];
  if (!response.ok || !blueprint) throw new Error(payload.error ?? "Ollama did not return a blueprint.");
  return blueprint;
}

function requestBlueprint(idea: string, graphName: string, selectedModel: string, graphDescription = "") {
  return selectedModel.startsWith("Ollama")
    ? requestOllamaBlueprint(idea, graphName, selectedModel, graphDescription)
    : requestGeminiBlueprint(idea, graphName, selectedModel, graphDescription);
}

async function requestOllamaImpact(idea: string, graphName: string, path: RoutePathItem[]): Promise<Omit<RouteAssessment, "routeKey">> {
  const response = await fetch("/api/impact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea, graphName, path }),
  });
  const payload = await response.json() as { impact?: DecisionImpact & { rationale: string }; model?: string; provider?: string; error?: string };
  if (!response.ok || !payload.impact) throw new Error(payload.error ?? "Ollama could not assess this path.");
  return { ...payload.impact, model: payload.model ?? "Local model", provider: payload.provider ?? "Ollama" };
}

async function requestOllamaEdgeRelation(idea: string, graphName: string, source: EdgeEndpoint, target: EdgeEndpoint): Promise<EdgeClassification> {
  const response = await fetch("/api/edge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea, graphName, source, target }),
  });
  const payload = await response.json() as { relation?: EdgeClassification["relation"]; rationale?: string; provider?: string; error?: string };
  if (!response.ok || !payload.relation || !payload.rationale) throw new Error(payload.error ?? "Ollama could not validate this connection.");
  return { relation: payload.relation, rationale: payload.rationale, provider: payload.provider };
}

async function requestIntegrationStatus(): Promise<IntegrationStatus> {
  const response = await fetch("/api/integrations");
  const payload = await response.json() as { integrations?: IntegrationStatus };
  if (!response.ok || !payload.integrations) throw new Error("Integration status is unavailable.");
  return payload.integrations;
}

async function sendDecisionEvent(input: {
  projectId: string;
  projectTitle: string;
  graphName: string;
  eventType: string;
  detail: string;
  metadata?: Record<string, unknown>;
  backboardThreadId?: string;
}) {
  const response = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json() as { backboard?: { threadId?: string }; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Decision event could not be stored.");
  return payload;
}

async function requestGeminiBuildBrief(idea: string, routes: ProjectRoute[], selectedModel: string): Promise<BriefSection[]> {
  const model = geminiModelIds[selectedModel as keyof typeof geminiModelIds] ?? geminiModelIds["Gemini 3.5 Flash-Lite"];
  const response = await fetch("/api/brief", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea, routes, model }),
  });
  const payload = await response.json() as { sections?: BriefSection[]; error?: string };
  if (!response.ok || !payload.sections) throw new Error(payload.error ?? "Gemini did not return a build brief.");
  return payload.sections;
}

function prepareProject(idea: string, drafts: GraphDraft[], model: string, generatedBlueprints?: GeneratedBlueprint[]): WebbedProject {
  const graphNames = drafts.map((draft) => draft.name);
  const graphIds = graphNames.map((_, index) => `graph-${index}`);
  return {
    id: `project-${Date.now()}`,
    title: titleFromIdea(idea),
    idea,
    model,
    graphs: graphNames.map((name, index) => {
      const dependsOn = index > 0 ? [graphIds[index - 1]] : [];
      const generated = generatedBlueprints?.[index];
      if (generated) {
        return graphFromBlueprint({
          id: graphIds[index],
          name,
          purpose: generated.purpose,
          description: drafts[index].description,
          dependsOn,
          stages: generated.stages,
        });
      }
      return graphFromBlueprint({ ...generateBlueprint(graphIds[index], name, idea, dependsOn), description: drafts[index].description });
    }),
    brief: generateBrief(idea),
  };
}

function hasPath(edges: DecisionEdge[], source: string, target: string): boolean {
  const visited = new Set<string>();
  const stack = [source];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    edges.filter((edge) => edge.source === current).forEach((edge) => stack.push(edge.target));
  }
  return false;
}

function getConflictReason(nodes: DecisionNode[], sourceId: string, targetId: string): string | undefined {
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  return source?.data.conflictsWith?.[targetId] ?? target?.data.conflictsWith?.[sourceId];
}

function fallbackImpact(node: DecisionNode): DecisionImpact {
  const hash = [...node.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return {
    latencyMs: 18 + (hash % 48),
    monthlyCost: 28 + (hash % 92),
    strain: 18 + (hash % 44),
  };
}

function selectedPathNodes(graph: DecisionGraph): DecisionNode[] {
  return graph.stages.map((stage) =>
    graph.nodes.find((node) => node.data.groupId === stage.id && node.data.status === "chosen")
    ?? graph.nodes.find((node) => node.data.groupId === stage.id),
  ).filter((node): node is DecisionNode => Boolean(node));
}

function strainLabel(strain: number) {
  return strain >= 62 ? "High" : strain >= 38 ? "Moderate" : "Low";
}

function getGraphAnalytics(graph: DecisionGraph) {
  const activeNodes = selectedPathNodes(graph);
  const total = activeNodes.reduce((result, node) => {
    const impact = node.data.impact ?? fallbackImpact(node);
    return {
      latencyMs: result.latencyMs + impact.latencyMs,
      monthlyCost: result.monthlyCost + impact.monthlyCost,
      strain: result.strain + impact.strain,
    };
  }, { latencyMs: 0, monthlyCost: 0, strain: 0 });
  const conflicts = graph.edges.filter((edge) => edge.data?.relation === "conflicts").length;
  const strain = Math.min(100, Math.round(total.strain / Math.max(activeNodes.length, 1)) + conflicts * 18);
  const label = strainLabel(strain);

  return { ...total, strain, strainLabel: label, conflictCount: conflicts };
}

function projectRoutes(project: WebbedProject): ProjectRoute[] {
  return project.graphs.map((graph) => ({
    name: graph.name,
    decisions: selectedPathNodes(graph).map((node) => ({
      stage: node.data.groupTitle ?? "Decision",
      choice: node.data.title,
      detail: node.data.subtitle,
    })),
  }));
}

function routeSummary(routes: ProjectRoute[], pattern: RegExp) {
  const route = routes.find((item) => pattern.test(item.name));
  return route?.decisions.map((decision) => decision.choice).join(" -> ") ?? "Selected decisions will appear here.";
}

function createLiveBrief(project: WebbedProject, routes: ProjectRoute[]): BriefSection[] {
  const totals = project.graphs.map(getGraphAnalytics).reduce((sum, impact) => ({
    latencyMs: sum.latencyMs + impact.latencyMs,
    monthlyCost: sum.monthlyCost + impact.monthlyCost,
    strain: sum.strain + impact.strain,
  }), { latencyMs: 0, monthlyCost: 0, strain: 0 });
  const averageStrain = Math.round(totals.strain / Math.max(project.graphs.length, 1));

  return [
    { id: "live-problem", title: "Problem and audience", body: project.idea },
    { id: "live-product", title: "Product path", body: routeSummary(routes, /product/i) },
    { id: "live-technical", title: "Technical plan", body: routeSummary(routes, /technical/i) },
    { id: "live-build", title: "MVP build order", body: `Build the selected route left to right: ${routes.flatMap((route) => route.decisions.map((decision) => decision.choice)).join(" -> ")}.` },
    { id: "live-demo", title: "Demo story", body: `${routeSummary(routes, /pitch|scope|brief|description/i)} Estimated selected-path impact: ${totals.latencyMs} ms, $${totals.monthlyCost}/month, ${strainLabel(averageStrain).toLowerCase()} strain.` },
  ];
}

function markdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function projectMarkdown(project: WebbedProject, sections: BriefSection[]) {
  const graphs = project.graphs.map((graph) => {
    const decisions = selectedPathNodes(graph).map((node) =>
      `| ${markdownCell(node.data.groupTitle ?? "Decision")} | ${markdownCell(node.data.title)} | ${markdownCell(node.data.pro)} | ${markdownCell(node.data.con)} |`,
    ).join("\n");
    const relationships = graph.edges
      .filter((edge) => edge.data?.origin === "user")
      .map((edge) => {
        const source = graph.nodes.find((node) => node.id === edge.source)?.data.title ?? edge.source;
        const target = graph.nodes.find((node) => node.id === edge.target)?.data.title ?? edge.target;
        return `- ${source} ${edge.data?.relation ?? "supports"} ${target}: ${edge.data?.rationale ?? "User-defined relationship."}`;
      }).join("\n");
    return `## ${graph.name}\n\n${graph.purpose}\n\n| Stage | Selected decision | Benefit | Trade-off |\n| --- | --- | --- | --- |\n${decisions}${relationships ? `\n\n### Custom relationships\n\n${relationships}` : ""}`;
  }).join("\n\n");
  const brief = sections.map((section) => `### ${section.title}\n\n${section.body}`).join("\n\n");
  return `# ${project.title}\n\n${project.idea}\n\n**Architect model:** ${project.model}\n\n${graphs}\n\n## Build Brief\n\n${brief}\n`;
}

export default function App() {
  const [savedWorkspace, setSavedWorkspace] = useState<SavedWorkspace | undefined>(() => loadSavedWorkspace());
  const [screen, setScreen] = useState<"setup" | "workspace">("setup");
  const [light, setLight] = useState(() => localStorage.getItem("webbed-theme") === "light");
  const [idea, setIdea] = useState(seedProject.idea);
  const [model, setModel] = useState("Gemini 3.5 Flash-Lite");
  const [graphDrafts, setGraphDrafts] = useState<GraphDraft[]>(defaultGraphNames.map((name) => ({ name, description: "" })));
  const [project, setProject] = useState<WebbedProject>(() => savedWorkspace?.project ?? cloneProject());
  const [activeGraphId, setActiveGraphId] = useState(project.graphs[0].id);
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [selectedEdgeId, setSelectedEdgeId] = useState<string>();
  const [toast, setToast] = useState<string>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [architectingGraphIds, setArchitectingGraphIds] = useState<string[]>([]);
  const [generationWarning, setGenerationWarning] = useState<string>();
  const [routeAssessment, setRouteAssessment] = useState<RouteAssessment>();
  const [isAssessingRoute, setIsAssessingRoute] = useState(false);
  const [generatedBrief, setGeneratedBrief] = useState<GeneratedBrief | undefined>(savedWorkspace?.generatedBrief);
  const [reviewGraphIds, setReviewGraphIds] = useState<string[]>(savedWorkspace?.reviewGraphIds ?? []);
  const [backboardThreadId, setBackboardThreadId] = useState(savedWorkspace?.backboardThreadId);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>(emptyIntegrationStatus);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [outputView, setOutputView] = useState<"json" | "brief">("json");
  const [showOutput, setShowOutput] = useState(false);
  const assessmentCache = useRef(new Map<string, RouteAssessment>());

  const activeGraph = project.graphs.find((graph) => graph.id === activeGraphId) ?? project.graphs[0];
  const selectedNode = activeGraph.nodes.find((node) => node.id === selectedNodeId);
  const selectedEdge = activeGraph.edges.find((edge) => edge.id === selectedEdgeId);
  const siblingNodes = selectedNode
    ? activeGraph.nodes.filter((node) => node.data.groupId === selectedNode.data.groupId)
    : [];
  const graphAnalytics = useMemo(() => getGraphAnalytics(activeGraph), [activeGraph]);
  const selectedPath = useMemo<RoutePathItem[]>(() => selectedPathNodes(activeGraph).map((node) => ({
    stage: node.data.groupTitle ?? "Decision",
    choice: node.data.title,
    detail: node.data.subtitle,
  })), [activeGraph]);
  const routeKey = `${project.id}:${activeGraph.id}:${JSON.stringify(selectedPath)}`;
  const isOllamaAssessmentCurrent = routeAssessment?.routeKey === routeKey;
  const displayedAnalytics = isOllamaAssessmentCurrent
    ? { ...graphAnalytics, ...routeAssessment, strainLabel: strainLabel(routeAssessment.strain) }
    : graphAnalytics;
  const selectedProjectRoutes = useMemo(() => projectRoutes(project), [project]);
  const briefSignature = `${project.id}:${JSON.stringify(selectedProjectRoutes)}`;
  const liveBrief = useMemo(() => createLiveBrief(project, selectedProjectRoutes), [project, selectedProjectRoutes]);
  const displayedBrief = generatedBrief?.signature === briefSignature ? generatedBrief.sections : liveBrief;
  const handoffJson = useMemo(() => JSON.stringify(createHandoff(project, reviewGraphIds, architectingGraphIds), null, 2), [project, reviewGraphIds, architectingGraphIds]);
  const activeDecisionCount = useMemo(() => project.graphs.reduce(
    (count, graph) => count + graph.nodes.filter((node) => node.data.status === "chosen").length,
    0,
  ), [project]);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 2200);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestIntegrationStatus()
      .then((status) => { if (!cancelled) setIntegrationStatus(status); })
      .catch(() => { if (!cancelled) setIntegrationStatus(emptyIntegrationStatus); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (screen !== "workspace") return;
    const timer = window.setTimeout(() => {
      const saved: SavedWorkspace = {
        project,
        generatedBrief,
        reviewGraphIds,
        backboardThreadId,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(workspaceStorageKey, JSON.stringify(saved));
      setSavedWorkspace(saved);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [backboardThreadId, generatedBrief, project, reviewGraphIds, screen]);

  const publishDecisionEvent = useCallback((graphName: string, eventType: string, detail: string, metadata?: Record<string, unknown>) => {
    if (!integrationStatus.backboard.configured) return;
    void sendDecisionEvent({
      projectId: project.id,
      projectTitle: project.title,
      graphName,
      eventType,
      detail,
      metadata,
      backboardThreadId,
    }).then((result) => {
      const threadId = result.backboard?.threadId;
      if (threadId) setBackboardThreadId(threadId);
    }).catch(() => undefined);
  }, [backboardThreadId, integrationStatus.backboard.configured, project.id, project.title]);

  useEffect(() => {
    if (screen !== "workspace" || selectedPath.length < 2) return;
    const cached = assessmentCache.current.get(routeKey);
    if (cached) {
      setRouteAssessment(cached);
      setIsAssessingRoute(false);
      return;
    }

    let cancelled = false;
    setIsAssessingRoute(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await requestOllamaImpact(project.idea, activeGraph.name, selectedPath);
        if (cancelled) return;
        const assessment = { ...result, routeKey };
        assessmentCache.current.set(routeKey, assessment);
        setRouteAssessment(assessment);
      } catch {
        if (!cancelled) setRouteAssessment(undefined);
      } finally {
        if (!cancelled) setIsAssessingRoute(false);
      }
    }, 650);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeGraph.name, project.idea, routeKey, screen]);

  const toggleTheme = () => {
    setLight((current) => {
      localStorage.setItem("webbed-theme", current ? "dark" : "light");
      return !current;
    });
  };

  const updateGraph = useCallback((graphId: string, update: (graph: DecisionGraph) => DecisionGraph) => {
    setProject((current) => ({
      ...current,
      graphs: current.graphs.map((graph) => graph.id === graphId ? update(graph) : graph),
    }));
  }, []);

  const recordGraphDecisionChange = useCallback((graphId: string) => {
    const downstream = downstreamGraphIds(project.graphs, graphId);
    setReviewGraphIds((current) => {
      const next = new Set(current.filter((id) => id !== graphId));
      downstream.forEach((id) => next.add(id));
      return [...next];
    });
    setGeneratedBrief(undefined);
  }, [project.graphs]);

  const onNodesChange = useCallback((changes: NodeChange<DecisionNode>[]) => {
    const deleted = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id));
    updateGraph(activeGraph.id, (graph) => {
      const updated = { ...graph, nodes: applyNodeChanges(changes.filter((change) => change.type !== "remove"), graph.nodes) };
      return deleted.size ? removeNodes(updated, deleted) : updated;
    });
    if (deleted.size) recordGraphDecisionChange(activeGraph.id);
  }, [activeGraph.id, recordGraphDecisionChange, updateGraph]);

  const onEdgesChange = useCallback((changes: EdgeChange<DecisionEdge>[]) => {
    updateGraph(activeGraph.id, (graph) => ({ ...graph, edges: applyEdgeChanges(changes, graph.edges) }));
  }, [activeGraph.id, updateGraph]);

  const isValidConnection = useCallback((connection: Connection | DecisionEdge) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return false;
    const source = activeGraph.nodes.find((node) => node.id === connection.source);
    const target = activeGraph.nodes.find((node) => node.id === connection.target);
    if (!source || !target) return false;
    const from = activeGraph.stages.findIndex((stage) => stage.id === source.data.groupId);
    const to = activeGraph.stages.findIndex((stage) => stage.id === target.data.groupId);
    return from < to && !hasPath(activeGraph.edges, connection.target, connection.source);
  }, [activeGraph.edges, activeGraph.nodes, activeGraph.stages]);

  const validateConnection = useCallback(async (
    graphId: string,
    graphName: string,
    edgeId: string,
    source: EdgeEndpoint,
    target: EdgeEndpoint,
  ) => {
    try {
      const result = await requestOllamaEdgeRelation(project.idea, graphName, source, target);
      updateGraph(graphId, (graph) => ({
        ...graph,
        edges: graph.edges.map((edge) => edge.id === edgeId && edge.source === source.id && edge.target === target.id
          ? {
            ...edge,
            animated: result.relation !== "conflicts",
            data: { ...edge.data, ...result, validationStatus: "validated" },
          }
          : edge),
      }));
      notify(result.relation === "conflicts"
        ? "Conflict detected. Review the yellow connection."
        : `Connection classified as ${result.relation}.`);
    } catch {
      updateGraph(graphId, (graph) => ({
        ...graph,
        edges: graph.edges.map((edge) => edge.id === edgeId && edge.source === source.id && edge.target === target.id
          ? {
            ...edge,
            data: {
              ...edge.data,
              relation: "supports",
              rationale: "Ollama was unavailable, so this connection remains an unverified manual link.",
              validationStatus: "fallback",
            },
          }
          : edge),
      }));
      notify("Connection kept, but Ollama could not validate it.");
    }
  }, [notify, project.idea, updateGraph]);

  const onConnect = useCallback((connection: Connection) => {
    if (!isValidConnection(connection)) {
      notify("Connections must move forward to a later stage.");
      return;
    }
    const conflictReason = getConflictReason(activeGraph.nodes, connection.source, connection.target);
    const sourceNode = activeGraph.nodes.find((node) => node.id === connection.source);
    const targetNode = activeGraph.nodes.find((node) => node.id === connection.target);
    const newEdge: DecisionEdge = {
      ...connection,
      id: `edge-${crypto.randomUUID()}`,
      type: "relation",
      data: {
        relation: conflictReason ? "conflicts" : "supports",
        rationale: conflictReason ?? "Ollama is checking this connection.",
        origin: "user",
        validationStatus: conflictReason ? "validated" : "pending",
      },
    };
    updateGraph(activeGraph.id, (graph) => connectRoute(graph, newEdge));
    recordGraphDecisionChange(activeGraph.id);
    if (sourceNode && targetNode) {
      publishDecisionEvent(activeGraph.name, "edge_connected", `${sourceNode.data.title} connected to ${targetNode.data.title}.`, {
        source: sourceNode.data.title,
        target: targetNode.data.title,
      });
    }
    setSelectedEdgeId(newEdge.id);
    setSelectedNodeId(undefined);
    if (conflictReason) {
      notify("Conflict detected. Review the yellow connection.");
    } else if (sourceNode && targetNode) {
      void validateConnection(
        activeGraph.id,
        activeGraph.name,
        newEdge.id,
        { id: sourceNode.id, stage: sourceNode.data.groupTitle ?? "Decision", choice: sourceNode.data.title, detail: sourceNode.data.subtitle },
        { id: targetNode.id, stage: targetNode.data.groupTitle ?? "Decision", choice: targetNode.data.title, detail: targetNode.data.subtitle },
      );
    }
  }, [activeGraph.id, activeGraph.name, activeGraph.nodes, isValidConnection, notify, publishDecisionEvent, recordGraphDecisionChange, updateGraph, validateConnection]);

  const onReconnect = useCallback((oldEdge: DecisionEdge, connection: Connection) => {
    if (!isValidConnection(connection)) {
      notify("Connections must move forward to a later stage.");
      return;
    }
    const conflictReason = getConflictReason(activeGraph.nodes, connection.source, connection.target);
    const sourceNode = activeGraph.nodes.find((node) => node.id === connection.source);
    const targetNode = activeGraph.nodes.find((node) => node.id === connection.target);
    updateGraph(activeGraph.id, (graph) => connectRoute(graph, {
      ...oldEdge, ...connection, animated: !conflictReason,
      data: { relation: conflictReason ? "conflicts" : "supports",
        rationale: conflictReason ?? "Ollama is checking this rewired connection.",
        origin: "user", validationStatus: conflictReason ? "validated" : "pending" },
    }, oldEdge.id));
    recordGraphDecisionChange(activeGraph.id);
    if (sourceNode && targetNode) {
      publishDecisionEvent(activeGraph.name, "edge_rewired", `${sourceNode.data.title} now connects to ${targetNode.data.title}.`, {
        source: sourceNode.data.title,
        target: targetNode.data.title,
      });
    }
    if (conflictReason) {
      notify("Conflict detected. Review the yellow connection.");
    } else if (sourceNode && targetNode) {
      void validateConnection(
        activeGraph.id,
        activeGraph.name,
        oldEdge.id,
        { id: sourceNode.id, stage: sourceNode.data.groupTitle ?? "Decision", choice: sourceNode.data.title, detail: sourceNode.data.subtitle },
        { id: targetNode.id, stage: targetNode.data.groupTitle ?? "Decision", choice: targetNode.data.title, detail: targetNode.data.subtitle },
      );
    }
  }, [activeGraph.id, activeGraph.name, activeGraph.nodes, isValidConnection, notify, publishDecisionEvent, recordGraphDecisionChange, updateGraph, validateConnection]);

  const updateNode = (nodeId: string, patch: Partial<DecisionNode["data"]>) => {
    updateGraph(activeGraph.id, (graph) => {
      const selected = graph.nodes.find((node) => node.id === nodeId);
      if (!selected) return graph;
      const nodes = graph.nodes.map((node) => ({ ...node, data: {
        ...node.data,
        ...(node.id === nodeId ? patch : {}),
        ...(patch.groupTitle !== undefined && node.data.groupId === selected.data.groupId ? { groupTitle: patch.groupTitle } : {}),
      } }));
      return { ...graph, nodes, stages: graph.stages.map((stage) => stage.id === selected.data.groupId
        ? { ...stage, title: patch.groupTitle ?? stage.title, options: nodes.filter((node) => node.data.groupId === stage.id).map((node) => ({
          id: node.id, label: node.data.title, subtitle: node.data.subtitle, pro: node.data.pro, con: node.data.con,
          why: node.data.why, downstream: node.data.downstream, impact: node.data.impact,
        })) } : stage) };
    });
    recordGraphDecisionChange(activeGraph.id);
  };

  const selectOption = (nodeId: string, optionId: string) => {
    updateNode(nodeId, { selectedOptionId: optionId, status: "chosen" });
    notify("Decision applied to the live project state.");
  };

  const selectRouteNode = (nodeId: string) => {
    const currentNode = activeGraph.nodes.find((node) => node.id === nodeId);
    if (!currentNode || currentNode.data.status === "chosen") return;
    updateGraph(activeGraph.id, (graph) => chooseNode(graph, nodeId));
    recordGraphDecisionChange(activeGraph.id);
    publishDecisionEvent(activeGraph.name, "decision_selected", `${currentNode.data.groupTitle ?? "Decision"}: ${currentNode.data.title}.`, {
      stage: currentNode.data.groupTitle,
      choice: currentNode.data.title,
    });
  };

  const updateEdge = (edgeId: string, relation: RelationType) => {
    updateGraph(activeGraph.id, (graph) => ({
      ...graph,
      edges: graph.edges.map((edge) => edge.id === edgeId ? {
        ...edge,
        data: {
          ...edge.data,
          relation,
          validationStatus: "validated",
          rationale: relation === "conflicts"
            ? "These decisions are incompatible without an override or adapter."
            : `The source decision ${relation} the target decision.`,
        },
      } : edge),
    }));
    recordGraphDecisionChange(activeGraph.id);
  };

  const deleteSelection = () => {
    updateGraph(activeGraph.id, (graph) => {
      if (selectedEdgeId) return { ...graph, edges: graph.edges.filter((edge) => edge.id !== selectedEdgeId) };
      if (selectedNodeId) return removeNodes(graph, new Set([selectedNodeId]));
      return graph;
    });
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    recordGraphDecisionChange(activeGraph.id);
  };

  const insertDecisionStep = () => {
    const sourceId = selectedEdge?.source ?? selectedNodeId;
    if (!sourceId) return;
    const id = `node-${crypto.randomUUID()}`;
    updateGraph(activeGraph.id, (graph) => insertStep(graph, sourceId, id));
    recordGraphDecisionChange(activeGraph.id);
    setSelectedNodeId(id);
    setSelectedEdgeId(undefined);
    notify("Step inserted into the selected route.");
  };

  const addDecisionNode = () => {
    if (!selectedNode) {
      notify("Select a node in the stage where you want another option.");
      return;
    }
    const id = `node-${crypto.randomUUID()}`;
    const stageId = selectedNode.data.groupId;
    const stageNodes = activeGraph.nodes.filter((node) => node.data.groupId === stageId);
    const position = {
      x: selectedNode.position.x,
      y: Math.max(...stageNodes.map((node) => node.position.y), selectedNode.position.y) + 210,
    };
    const newNode: DecisionNode = {
      id,
      type: "decision",
      position,
      data: {
        label: "New alternative",
        title: "New alternative",
        subtitle: "Describe a competing approach for this stage.",
        pro: "Adds another viable path",
        con: "Needs project-specific detail",
        description: "Describe how this option solves the same stage responsibility.",
        groupId: stageId,
        groupTitle: selectedNode.data.groupTitle,
        status: "ghost",
        isStarter: selectedNode.data.isStarter,
        options: [],
      },
    };
    updateGraph(activeGraph.id, (graph) => ({
      ...graph,
      stages: graph.stages.map((stage) => stage.id === stageId
        ? {
          ...stage,
          options: [...stage.options, {
            id,
            label: newNode.data.title,
            subtitle: newNode.data.subtitle,
            pro: newNode.data.pro,
            con: newNode.data.con,
          }],
        }
        : stage),
      nodes: [...graph.nodes, newNode],
    }));
    setSelectedNodeId(id);
    setSelectedEdgeId(undefined);
    notify(`Alternative added to ${selectedNode.data.groupTitle ?? "this stage"}.`);
  };

  const copyBrief = async () => {
    const output = displayedBrief.map((section) => `${section.title}\n${section.body}`).join("\n\n");
    await navigator.clipboard.writeText(output);
    notify("Project brief copied.");
  };

  const copyHandoff = async () => {
    try {
      await navigator.clipboard.writeText(handoffJson);
      notify("Build specification JSON copied.");
    } catch {
      notify("Clipboard unavailable. Download the JSON instead.");
    }
  };

  const downloadHandoff = () => {
    downloadText(`${filenameFromTitle(project.title)}-build-spec.json`, handoffJson, "application/json;charset=utf-8");
    notify("Build specification JSON downloaded.");
  };

  const downloadBrief = () => {
    downloadText(`${filenameFromTitle(project.title)}-brief.md`, projectMarkdown(project, displayedBrief), "text/markdown;charset=utf-8");
    notify("Build brief downloaded.");
  };

  const downloadProject = () => {
    const bundle = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      project,
      finalizedBrief: displayedBrief,
    };
    downloadText(`${filenameFromTitle(project.title)}.webbed.json`, JSON.stringify(bundle, null, 2), "application/json;charset=utf-8");
    notify("Editable project JSON downloaded.");
  };

  const resumeWorkspace = () => {
    if (!savedWorkspace) return;
    const restored = structuredClone(savedWorkspace.project);
    setProject(restored);
    setActiveGraphId(restored.graphs[0].id);
    setGeneratedBrief(savedWorkspace.generatedBrief);
    setReviewGraphIds(savedWorkspace.reviewGraphIds);
    setBackboardThreadId(savedWorkspace.backboardThreadId);
    setIdea(restored.idea);
    setModel(restored.model.startsWith("Gemini 2.5") ? "Gemini 3.5 Flash-Lite" : restored.model);
    setGraphDrafts(restored.graphs.map((graph) => ({ name: graph.name, description: graph.description ?? "" })));
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setScreen("workspace");
    notify("Saved project restored.");
  };

  const acknowledgeGraphReview = () => {
    setReviewGraphIds((current) => current.filter((id) => id !== activeGraph.id));
    notify(`${activeGraph.name} reviewed against upstream changes.`);
  };

  const finalizeProject = async () => {
    if (reviewGraphIds.length > 0) {
      const names = project.graphs.filter((graph) => reviewGraphIds.includes(graph.id)).map((graph) => graph.name);
      notify(`Review ${names.join(" and ")} before finalizing.`);
      return;
    }
    setIsFinalizing(true);
    try {
      const sections = await requestGeminiBuildBrief(project.idea, selectedProjectRoutes, model);
      setGeneratedBrief({ signature: briefSignature, sections });
      publishDecisionEvent("Project", "project_finalized", `Finalized ${project.graphs.length} decision webs into a build brief.`, {
        graphCount: project.graphs.length,
        decisionCount: activeDecisionCount,
      });
      notify("Build-ready brief generated from your selected route.");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Gemini build brief generation failed.";
      notify(`${detail} Showing the live route brief instead.`);
    } finally {
      setIsFinalizing(false);
    }
  };

  const startWorkspace = async () => {
    const drafts = graphDrafts.map((draft) => ({ name: draft.name.trim(), description: draft.description.trim() })).filter((draft) => draft.name);
    const resolvedDrafts = drafts.length ? drafts : defaultGraphNames.map((name) => ({ name, description: "" }));
    const resolvedNames = resolvedDrafts.map((draft) => draft.name);
    setIsGenerating(true);
    setGenerationWarning(undefined);
    assessmentCache.current.clear();
    setRouteAssessment(undefined);
    setGeneratedBrief(undefined);
    setReviewGraphIds([]);
    setBackboardThreadId(undefined);
    let generatedBlueprints: GeneratedBlueprint[] | undefined;
    let generationMessage = "Generated local planning blueprint.";

    if (model.startsWith("Gemini") || model.startsWith("Ollama")) {
      try {
        generatedBlueprints = [await requestBlueprint(idea.trim(), resolvedNames[0], model, resolvedDrafts[0].description)];
        generationMessage = `${model.startsWith("Ollama") ? "Ollama" : "Gemini"} generated the first decision web. Architecting the rest in the background.`;
      } catch (error) {
        const detail = error instanceof Error ? error.message : "AI graph generation failed.";
        generationMessage = `${detail} Using the local planning fallback.`;
        setGenerationWarning(detail);
      }
    }

    const next = prepareProject(idea.trim(), resolvedDrafts, model, generatedBlueprints);
    setProject(next);
    setActiveGraphId(next.graphs[0].id);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
    setScreen("workspace");
    setIsGenerating(false);
    notify(generationMessage);

    if (generatedBlueprints && resolvedNames.length > 1) {
      const remainingGraphs = next.graphs.slice(1);
      setArchitectingGraphIds(remainingGraphs.map((graph) => graph.id));

      void (async () => {
        for (const graph of remainingGraphs) {
          try {
            const blueprint = await requestBlueprint(idea.trim(), graph.name, model, graph.description);
            setProject((current) => current.id === next.id
              ? {
                ...current,
                graphs: current.graphs.map((item) => item.id === graph.id
                  ? graphFromBlueprint({
                    id: item.id,
                    name: item.name,
                    description: item.description,
                    purpose: blueprint.purpose,
                    dependsOn: item.dependsOn,
                    stages: blueprint.stages,
                  })
                  : item),
              }
              : current);
          } catch {
            setGenerationWarning(`${graph.name} could not be generated, so Webbed is showing its starter plan.`);
            notify(`${graph.name} kept its local planning fallback.`);
          } finally {
            setArchitectingGraphIds((current) => current.filter((graphId) => graphId !== graph.id));
          }
        }
        notify("Web generation finished.");
      })();
    }
  };

  const chooseGraph = (graphId: string) => {
    setActiveGraphId(graphId);
    setSelectedNodeId(undefined);
    setSelectedEdgeId(undefined);
  };

  if (screen === "setup") {
    return (
      <main className={`setup-screen ${light ? "theme-light" : "theme-dark"}`}>
        <WebBackground light={light} />
        <button className="icon-button theme-button" type="button" onClick={toggleTheme} title={`Use ${light ? "dark" : "light"} mode`}>
          {light ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        <section className="hero-copy">
          <span className="brand">Web Design</span>
          <h1>Stop rewriting prompts.<span>Edit<br />the decisions</span>behind the output.</h1>
          <p>Turn a rough idea into sequential decision webs, rewire the flow, and generate a build-ready project from the chosen path.</p>
          <div className="feature-row"><span>Multi-web planning</span><span>Edge rewiring</span><span>Live output</span></div>
        </section>

        <form className="setup-form" onSubmit={(event) => { event.preventDefault(); void startWorkspace(); }}>
          <label className="field"><span>Project idea</span><textarea rows={5} value={idea} onChange={(event) => setIdea(event.target.value)} /></label>
          <div className="form-section-heading"><span>Graph functions</span><button type="button" onClick={() => setGraphDrafts((items) => [...items, { name: `Graph ${items.length + 1}`, description: "" }])}><Plus size={15} /> Add graph</button></div>
          <div className="graph-fields">
            {graphDrafts.map((draft, index) => (
              <div className="graph-field" key={index}>
                <input value={draft.name} aria-label={`Graph ${index + 1} function`} onChange={(event) => setGraphDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
                <button className="icon-button" type="button" title="Remove graph" onClick={() => setGraphDrafts((items) => items.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button>
                <textarea rows={2} maxLength={2000} value={draft.description} aria-label={`Graph ${index + 1} description`} placeholder="Description (optional)" onChange={(event) => setGraphDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} />
              </div>
            ))}
          </div>
          <label className="field"><span>AI model</span><select value={model} onChange={(event) => setModel(event.target.value)}><option>Gemini 3.5 Flash-Lite</option><option>Gemini 3.5 Flash</option><option>Ollama: gpt-oss:20b-cloud</option><option>Ollama: llama3.1:8b</option><option>Ollama: gemma3:4b</option></select></label>
          <button className="primary-action" type="submit" disabled={isGenerating}>{isGenerating ? <Sparkles size={17} /> : <WandSparkles size={17} />}{isGenerating ? "Mapping first web" : "Generate web"}</button>
          {savedWorkspace && (
            <button className="saved-workspace" type="button" onClick={resumeWorkspace}>
              <History size={17} />
              <span><strong>Resume {savedWorkspace.project.title}</strong><small>Saved {new Date(savedWorkspace.savedAt).toLocaleString()}</small></span>
            </button>
          )}
        </form>
      </main>
    );
  }

  return (
    <main className={`workspace ${light ? "theme-light" : "theme-dark"}`}>
      <header className="workspace-header">
        <div className="workspace-title"><button className="brand-button" type="button" onClick={() => setScreen("setup")}>Webbed</button><span /><div><small>Decision canvas</small><h1>{project.title}</h1></div></div>
        <div className="header-actions">
          <button className="icon-button output-toggle" type="button" title="Open build handoff" aria-expanded={showOutput} onClick={() => setShowOutput((open) => !open)}><FileJson size={17} /></button>
          <span className="model-badge"><Sparkles size={13} /> {project.model}</span>
          {generationWarning && <span className="generation-warning" title={generationWarning}><AlertTriangle size={13} /> Starter plan</span>}
          <button className="secondary-action" type="button" onClick={copyBrief}><Clipboard size={15} /> Copy brief</button>
          <button className="icon-button" type="button" onClick={downloadBrief} title="Download build brief"><Download size={16} /></button>
          <button className="icon-button" type="button" onClick={downloadProject} title="Download editable project JSON"><FileJson size={16} /></button>
          <button className="primary-action primary-action--compact" type="button" onClick={() => void finalizeProject()} disabled={isFinalizing}>{isFinalizing ? <Sparkles size={16} /> : <Check size={16} />}{isFinalizing ? "Writing brief" : "Finalize"}</button>
          <button className="icon-button" type="button" onClick={toggleTheme} title={`Use ${light ? "dark" : "light"} mode`}>{light ? <Moon size={17} /> : <Sun size={17} />}</button>
        </div>
      </header>

      <nav className="graph-switcher" aria-label="Project graphs">
        <span className="graph-switcher__label"><Network size={15} /> Webs</span>
        {project.graphs.map((graph) => {
          const isArchitecting = architectingGraphIds.includes(graph.id);
          const needsReview = reviewGraphIds.includes(graph.id);
          return (
          <button className={graph.id === activeGraph.id ? "is-active" : ""} type="button" key={graph.id} onClick={() => chooseGraph(graph.id)} disabled={isArchitecting}>
            {graph.name}{isArchitecting ? <small>Architecting</small> : needsReview ? <small className="needs-review">Review</small> : graph.dependsOn.length > 0 && <small>{graph.dependsOn.length} upstream</small>}
          </button>
          );
        })}
        {integrationStatus.backboard.configured && (
          <div className="integration-status" aria-label="Decision memory">
            <span className="is-configured" title="Backboard decision memory configured"><i />Backboard</span>
          </div>
        )}
      </nav>

      <div className="workspace-body">
        <Inspector
          node={selectedNode}
          edge={selectedEdge}
          siblingNodes={siblingNodes}
          onUpdateNode={updateNode}
          onSelectOption={selectOption}
          onChooseNode={(nodeId) => { selectRouteNode(nodeId); setSelectedNodeId(nodeId); }}
          onUpdateEdge={updateEdge}
          onDelete={deleteSelection}
        />

        <section className="canvas-shell">
          <header className="canvas-heading">
            <div><h2>{activeGraph.name}</h2><p>{activeGraph.purpose}</p></div>
            <div className="canvas-heading__actions">
              {reviewGraphIds.includes(activeGraph.id) && <button className="review-action" type="button" onClick={acknowledgeGraphReview}><AlertTriangle size={15} /> Review upstream change</button>}
              <button className="secondary-action" type="button" onClick={insertDecisionStep} disabled={!selectedNode && !selectedEdge} title="Insert a step after the selected node or into the selected connection" aria-label="Insert step"><Plus size={15} /> Insert step</button>
              <button className="secondary-action" type="button" onClick={addDecisionNode} title="Add an alternative to the selected decision stage"><Plus size={15} /> Add option</button>
            </div>
          </header>
          <div className="flow-canvas">
            <FlowWebBackground light={light} />
            <div className="stage-strip" style={{ gridTemplateColumns: `repeat(${Math.max(activeGraph.stages.length, 1)}, 1fr)` }}>
              {activeGraph.stages.map((stage) => <span key={stage.id}>{stage.title}</span>)}
            </div>
            <ReactFlow<DecisionNode, DecisionEdge>
              nodes={activeGraph.nodes}
              edges={activeGraph.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => { selectRouteNode(node.id); setSelectedNodeId(node.id); setSelectedEdgeId(undefined); }}
              onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(undefined); }}
              onPaneClick={() => { setSelectedNodeId(undefined); setSelectedEdgeId(undefined); }}
              onConnect={onConnect}
              onReconnect={onReconnect}
              isValidConnection={isValidConnection}
              fitView
              fitViewOptions={{ padding: 0.14, maxZoom: 1.15 }}
              minZoom={0.3}
              maxZoom={1.8}
              nodesConnectable
              edgesReconnectable
              snapToGrid
              snapGrid={[20, 20]}
              defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 } }}
              colorMode={light ? "light" : "dark"}
              deleteKeyCode={["Backspace", "Delete"]}
            >
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(node) => node.data?.isStarter ? "#6d28d9" : "#c4b5fd"} />
            </ReactFlow>
          </div>
          <footer className="graph-analytics" aria-label="Selected path analytics">
            <div className="graph-analytics__metric">
              <Activity size={15} aria-hidden="true" />
              <div><span>Est. MVP latency</span><strong>{displayedAnalytics.latencyMs} ms</strong></div>
            </div>
            <div className="graph-analytics__metric">
              <CircleDollarSign size={15} aria-hidden="true" />
              <div><span>Est. MVP cost / month</span><strong>${displayedAnalytics.monthlyCost.toLocaleString()}</strong></div>
            </div>
            <div className="graph-analytics__metric">
              <Gauge size={15} aria-hidden="true" />
              <div><span>Architecture strain</span><strong className={`strain--${displayedAnalytics.strainLabel.toLowerCase()}`}>{displayedAnalytics.strainLabel} · {displayedAnalytics.strain}/100</strong></div>
            </div>
            <div className="graph-analytics__route">
              {graphAnalytics.conflictCount > 0
                ? `${graphAnalytics.conflictCount} path conflict${graphAnalytics.conflictCount === 1 ? "" : "s"}`
                : isAssessingRoute
                  ? "Ollama assessing route"
                  : isOllamaAssessmentCurrent
                    ? `${routeAssessment.provider}: ${routeAssessment.rationale}`
                    : "Selected path live"}
            </div>
          </footer>
        </section>

        <aside className={`output-panel ${showOutput ? "is-open" : ""}`}>
          <header><div><small>Live handoff</small><h2>{outputView === "json" ? "Build specification" : "Project brief"}</h2></div><button className="icon-button output-toggle" type="button" title="Close build handoff" onClick={() => setShowOutput(false)}><X size={16} /></button></header>
          <div className="output-toolbar">
            <div role="tablist" aria-label="Output format">
              <button id="output-json-tab" role="tab" type="button" aria-controls="output-json" aria-selected={outputView === "json"} onClick={() => setOutputView("json")}>JSON</button>
              <button id="output-brief-tab" role="tab" type="button" aria-controls="output-brief" aria-selected={outputView === "brief"} onClick={() => setOutputView("brief")}>Brief</button>
            </div>
            <button className="icon-button" type="button" title={outputView === "json" ? "Copy build JSON" : "Copy brief"} onClick={outputView === "json" ? copyHandoff : copyBrief}><Clipboard size={15} /></button>
            <button className="icon-button" type="button" title={outputView === "json" ? "Download build JSON" : "Download brief"} onClick={outputView === "json" ? downloadHandoff : downloadBrief}><Download size={15} /></button>
          </div>
          {outputView === "json" ? (
            <pre className="output-json" id="output-json" role="tabpanel" aria-labelledby="output-json-tab" tabIndex={0}><code>{handoffJson}</code></pre>
          ) : <div className="output-content" id="output-brief" role="tabpanel" aria-labelledby="output-brief-tab">
            {displayedBrief.map((section) => <section key={section.id}><h3>{section.title}</h3><p>{section.body}</p></section>)}
          </div>}
          <footer><span>{activeDecisionCount} decisions active</span><span>{architectingGraphIds.length ? "Generating" : reviewGraphIds.length ? "Needs review" : "Selected"}</span></footer>
        </aside>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
