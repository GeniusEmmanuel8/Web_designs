import type { DecisionBlueprint, DecisionEdge, DecisionGraph, DecisionNode, WebbedProject } from "../types";

const stageX = 290;
const optionY = 210;

function createRouteEdges(nodes: DecisionNode[], stages: DecisionBlueprint["stages"]): DecisionEdge[] {
  const selected = stages.map((stage) => nodes.find((node) => node.data.groupId === stage.id && node.data.status === "chosen"));

  return selected.slice(0, -1).flatMap((source, index) => {
    const target = selected[index + 1];
    if (!source || !target) return [];

    const conflictReason = source.data.conflictsWith?.[target.id] ?? target.data.conflictsWith?.[source.id];
    return [{
      id: `route-${source.id}-${target.id}`,
      source: source.id,
      target: target.id,
      type: "relation",
      animated: true,
      data: {
        relation: conflictReason ? "conflicts" : "flows_to",
        rationale: conflictReason ?? "This is the currently selected decision path.",
        origin: "route",
      },
    }];
  });
}

export function graphFromBlueprint(blueprint: DecisionBlueprint): DecisionGraph {
  const nodes = blueprint.stages.flatMap((stage, stageIndex) =>
    stage.options.map((option, optionIndex): DecisionNode => ({
      id: option.id,
      type: "decision",
      position: { x: stageIndex * stageX, y: 88 + optionIndex * optionY },
      data: {
        label: option.label,
        title: option.label,
        subtitle: option.subtitle,
        description: option.subtitle,
        pro: option.pro,
        con: option.con,
        why: option.why ?? option.subtitle,
        downstream: option.downstream ?? `${option.pro}. Watch for: ${option.con.toLowerCase()}.`,
        impact: option.impact,
        groupId: stage.id,
        groupTitle: stage.title,
        status: optionIndex === 0 ? "chosen" : "ghost",
        isStarter: stageIndex === 0,
        conflictsWith: option.conflictsWith,
        options: [],
      },
    })),
  );

  return {
    id: blueprint.id,
    name: blueprint.name,
    purpose: blueprint.purpose,
    description: blueprint.description,
    dependsOn: blueprint.dependsOn ?? [],
    stages: blueprint.stages,
    nodes,
    edges: createRouteEdges(nodes, blueprint.stages),
  };
}

// This mirrors the contract returned by an LLM. The UI has no knowledge of a fixed number or kind of stage.
export const dynamicLLMOutput: DecisionBlueprint = {
  id: "technical",
  name: "Technical Build",
  purpose: "Choose a practical Formula 1 data pipeline, then inspect the cost and complexity trade-offs of each route.",
  dependsOn: ["product"],
  stages: [
    {
      id: "stage_data_source",
      title: "Data source",
      options: [
        { id: "openf1", label: "OpenF1 Live API", subtitle: "Current sessions and telemetry for live race context.", pro: "Live race coverage", con: "Rate limits during peak traffic" },
        { id: "jolpica", label: "Jolpica Historical", subtitle: "Archived championship results for deeper comparisons.", pro: "History back to 1950", con: "No live telemetry" },
      ],
    },
    {
      id: "stage_ingestion",
      title: "Ingestion method",
      options: [
        { id: "polling", label: "REST Polling Workers", subtitle: "Fetch race updates on a controlled interval.", pro: "Simple AWS Lambda setup", con: "Consumes request quota" },
        { id: "stream", label: "WebSocket Streams", subtitle: "Process pushed events as they happen.", pro: "Near-real-time updates", con: "Requires resilient reconnects", conflictsWith: { baseline: "A continuous stream conflicts with the lean baseline unless an adapter aggregates events first." } },
      ],
    },
    {
      id: "stage_storage",
      title: "Race data store",
      options: [
        { id: "tiger", label: "Tiger Data", subtitle: "Relational race data and time-series project events in Postgres.", pro: "Excellent analytics queries", con: "Requires schema discipline" },
        { id: "dynamo", label: "Amazon DynamoDB", subtitle: "Low-latency denormalized snapshots behind AWS APIs.", pro: "Scales with demand", con: "Access patterns must be planned" },
      ],
    },
    {
      id: "stage_prediction",
      title: "Prediction engine",
      options: [
        { id: "baseline", label: "Weighted Baseline", subtitle: "Explain probabilities with form, reliability, and circuit fit.", pro: "Fast and transparent", con: "Less adaptive to surprises" },
        { id: "ml", label: "Trained Classifier", subtitle: "Learn from historical and live signals.", pro: "Improves with more data", con: "Needs training and monitoring" },
      ],
    },
  ],
};

const productBlueprint: DecisionBlueprint = {
  id: "product",
  name: "Product Design",
  purpose: "Shape the Formula 1 experience across the moments fans encounter before and during a race weekend.",
  stages: [
    {
      id: "stage_entry",
      title: "Entry point",
      options: [
        { id: "discover", label: "Race Discovery", subtitle: "Help fans find the championship, races, and teams that matter now.", pro: "Clear first action", con: "Needs timely race data" },
        { id: "weekend", label: "Race Weekend", subtitle: "Start with the next race and its complete event schedule.", pro: "Immediate relevance", con: "Narrower entry context" },
      ],
    },
    {
      id: "stage_tracking",
      title: "Track progress",
      options: [
        { id: "standings", label: "Live Standings", subtitle: "Rank drivers and constructors with movement and recent form.", pro: "Familiar user value", con: "Can become table-heavy" },
        { id: "calendar", label: "Race Calendar", subtitle: "Browse upcoming sessions, local times, circuits, and results.", pro: "Strong planning tool", con: "Less insight-led" },
      ],
    },
    {
      id: "stage_insight",
      title: "Build insight",
      options: [
        { id: "profiles", label: "Team Profiles", subtitle: "Show each team’s drivers, form, strengths, and trajectory.", pro: "Rich context", con: "More content to maintain" },
        { id: "compare", label: "Team Comparison", subtitle: "Compare pace, reliability, points, and circuit suitability.", pro: "Great for decisions", con: "Needs careful visual hierarchy" },
      ],
    },
    {
      id: "stage_outcome",
      title: "Deliver outcome",
      options: [
        { id: "forecast", label: "Race Forecast", subtitle: "Estimate likely winners using prior results and circuit fit.", pro: "Memorable AI moment", con: "Requires transparent reasoning" },
        { id: "alerts", label: "Race Alerts", subtitle: "Notify fans about sessions, prediction changes, and final results.", pro: "Brings users back", con: "Permission friction" },
      ],
    },
  ],
};

const storyBlueprint: DecisionBlueprint = {
  id: "story",
  name: "Project Description",
  purpose: "Turn the selected product and technical choices into a concise hackathon story with a memorable demo moment.",
  dependsOn: ["product", "technical"],
  stages: [
    {
      id: "stage_problem",
      title: "Frame the problem",
      options: [
        { id: "problem", label: "The Problem", subtitle: "Results show what happened but not what momentum means.", pro: "Easy to understand", con: "Needs a sharp example" },
        { id: "proof", label: "Demo Proof", subtitle: "Show one live sequence from new result to new forecast.", pro: "Demonstrates value", con: "Needs a polished flow" },
      ],
    },
    {
      id: "stage_audience",
      title: "Choose audience",
      options: [
        { id: "audience", label: "Everyday Fans", subtitle: "Fans who want context, not only raw standings.", pro: "Broad appeal", con: "Must stay approachable" },
        { id: "scores", label: "Data-focused Fans", subtitle: "Fans who follow rankings, pace, and season trends closely.", pro: "High engagement", con: "More advanced expectations" },
      ],
    },
    {
      id: "stage_message",
      title: "State the value",
      options: [
        { id: "value", label: "Explainable Forecasts", subtitle: "Combine scores, form, and predictions in one view.", pro: "Strong differentiator", con: "Needs clear explanations" },
        { id: "leaders", label: "Momentum Comparison", subtitle: "Show which teams gained momentum and why.", pro: "Tells a story", con: "Depends on useful data" },
      ],
    },
    {
      id: "stage_pitch",
      title: "Close the pitch",
      options: [
        { id: "pitch", label: "Fan-first Pitch", subtitle: "Know what happened, what it means, and who has the edge.", pro: "Human and concise", con: "Less technical depth" },
        { id: "winner", label: "Prediction Reveal", subtitle: "Finish with the likely winner for the upcoming race.", pro: "Excellent demo ending", con: "Needs confidence context" },
      ],
    },
  ],
};

export const seedProject: WebbedProject = {
  id: "formula-one-companion",
  title: "Formula One Companion",
  idea: "Build a website that tracks Formula 1 scores, ranks teams, and predicts likely winners for upcoming races.",
  model: "gpt-oss:20b-cloud",
  graphs: [graphFromBlueprint(productBlueprint), graphFromBlueprint(dynamicLLMOutput), graphFromBlueprint(storyBlueprint)],
  brief: [
    { id: "problem", title: "Problem", body: "Race results and standings show what happened, but leave fans to interpret momentum and likely outcomes themselves." },
    { id: "audience", title: "Audience", body: "Formula 1 fans who want an approachable view of scores, team form, and upcoming-race probabilities." },
    { id: "solution", title: "Solution", body: "A race companion combining championship tables, team comparisons, and explainable forecasts." },
    { id: "mvp", title: "MVP", body: "Race calendar, driver and constructor standings, team profiles, comparisons, and one explainable prediction model." },
    { id: "demo", title: "Demo Moment", body: "Update a race result and watch rankings, team momentum, and the next-race forecast change together." },
  ],
};
