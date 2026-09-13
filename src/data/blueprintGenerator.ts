import type { BriefSection, DecisionBlueprint, DecisionImpact, DecisionStage } from "../types";

// A stand-in for a real LLM call. Swap the body of `generateBlueprint` for a
// fetch to the selected model as soon as an endpoint exists — the function
// only needs to keep returning a `DecisionBlueprint` shaped like this one.
type StageArchetype = {
  key: string;
  title: string;
  options: Array<{ label: string; subtitle: string; pro: string; con: string }>;
};

const decisionImpacts: Record<string, [DecisionImpact, DecisionImpact]> = {
  entry: [{ latencyMs: 18, monthlyCost: 18, strain: 15 }, { latencyMs: 8, monthlyCost: 12, strain: 10 }],
  data_source: [{ latencyMs: 45, monthlyCost: 60, strain: 32 }, { latencyMs: 16, monthlyCost: 28, strain: 18 }],
  core_logic: [{ latencyMs: 28, monthlyCost: 24, strain: 24 }, { latencyMs: 115, monthlyCost: 180, strain: 68 }],
  storage: [{ latencyMs: 32, monthlyCost: 72, strain: 38 }, { latencyMs: 22, monthlyCost: 54, strain: 30 }],
  interface: [{ latencyMs: 42, monthlyCost: 38, strain: 46 }, { latencyMs: 20, monthlyCost: 58, strain: 34 }],
  delivery: [{ latencyMs: 20, monthlyCost: 32, strain: 22 }, { latencyMs: 36, monthlyCost: 66, strain: 48 }],
  feedback: [{ latencyMs: 95, monthlyCost: 90, strain: 42 }, { latencyMs: 165, monthlyCost: 210, strain: 72 }],
  deployment: [{ latencyMs: 36, monthlyCost: 110, strain: 26 }, { latencyMs: 26, monthlyCost: 72, strain: 62 }],
};

const stageArchetypes: StageArchetype[] = [
  {
    key: "entry",
    title: "Entry Point",
    options: [
      { label: "Guided Onboarding", subtitle: "Walk new users through the first successful action.", pro: "Higher first-session completion", con: "Adds friction for returning users" },
      { label: "Direct Dashboard", subtitle: "Drop users straight into the main workspace.", pro: "Fastest path to value", con: "Assumes users already know the domain" },
    ],
  },
  {
    key: "data_source",
    title: "Data Source",
    options: [
      { label: "Live API Feed", subtitle: "Pull current data from an external provider in real time.", pro: "Always up to date", con: "Depends on third-party uptime" },
      { label: "Curated Dataset", subtitle: "Ship a maintained snapshot the team controls directly.", pro: "Predictable and fast", con: "Needs manual refresh cycles" },
    ],
  },
  {
    key: "core_logic",
    title: "Core Logic",
    options: [
      { label: "Rule-based Engine", subtitle: "Encode domain logic as explicit, inspectable rules.", pro: "Transparent and easy to debug", con: "Brittle as edge cases grow" },
      { label: "Learned Model", subtitle: "Train a model on examples to generalize behavior.", pro: "Improves as more data arrives", con: "Harder to explain individual decisions" },
    ],
  },
  {
    key: "storage",
    title: "Storage Layer",
    options: [
      { label: "Relational Database", subtitle: "Store structured records with strong consistency.", pro: "Reliable joins and constraints", con: "Schema changes need migrations" },
      { label: "Document Store", subtitle: "Store flexible, denormalized records per entity.", pro: "Fast iteration on shape", con: "Consistency is the app's job" },
    ],
  },
  {
    key: "interface",
    title: "Interface",
    options: [
      { label: "Conversational UI", subtitle: "Let users describe what they want in plain language.", pro: "Low learning curve", con: "Harder to make outcomes predictable" },
      { label: "Visual Dashboard", subtitle: "Surface the state and controls directly on screen.", pro: "Fast scanning and comparison", con: "More surface area to design well" },
    ],
  },
  {
    key: "delivery",
    title: "Delivery Channel",
    options: [
      { label: "Web App", subtitle: "Reach every user through the browser.", pro: "One codebase, instant updates", con: "Limited offline capability" },
      { label: "API + Webhooks", subtitle: "Let other systems integrate directly.", pro: "Composable for partners", con: "Requires versioning discipline" },
    ],
  },
  {
    key: "feedback",
    title: "Feedback Loop",
    options: [
      { label: "Manual Review Queue", subtitle: "Route uncertain outcomes to a human for a final call.", pro: "Catches mistakes before they ship", con: "Doesn't scale without staffing" },
      { label: "Automated Retraining", subtitle: "Feed outcomes back into the system automatically.", pro: "Improves without manual work", con: "Needs monitoring to avoid drift" },
    ],
  },
  {
    key: "deployment",
    title: "Deployment Target",
    options: [
      { label: "Managed Cloud", subtitle: "Run on a provider that handles scaling and patching.", pro: "Less operational overhead", con: "Less control over the runtime" },
      { label: "Self-hosted Container", subtitle: "Run the stack on infrastructure the team owns.", pro: "Full control and data locality", con: "Team owns uptime and patching" },
    ],
  },
];

function formulaOneStages(graphName: string): DecisionStage[] {
  if (/technical/i.test(graphName)) {
    return [
      {
        id: "race-data", title: "Data inputs", options: [
          { id: "openf1-jolpica", label: "OpenF1 + Jolpica", subtitle: "Combine current telemetry with historical results and standings.", pro: "Covers live and historical context", con: "Two APIs to normalize", why: "This decides where every score, result, driver, team, and race signal originates.", downstream: "The sync layer receives results, schedules, lap/session context, and historical form from these sources.", impact: { latencyMs: 52, monthlyCost: 36, strain: 34 } },
          { id: "manual-seed", label: "Seeded race dataset", subtitle: "Ship a curated slice of recent races for a deterministic demo.", pro: "Fastest hackathon demo path", con: "Not live after launch", why: "This trades live coverage for a completely reliable demo dataset.", downstream: "Standings and forecasts run from bundled race records until a live provider is connected.", impact: { latencyMs: 10, monthlyCost: 4, strain: 12 } },
        ],
      },
      {
        id: "sync-validation", title: "Sync data", options: [
          { id: "scheduled-sync", label: "Scheduled sync worker", subtitle: "Fetch provider updates on a controlled interval and validate them server-side.", pro: "Simple, resilient, and cheap", con: "A few minutes behind live", why: "This decides how external race data enters the product without exposing provider credentials in the browser.", downstream: "Validated records are written only after duplicate checks, driver/team ID matching, and missing-result guards.", impact: { latencyMs: 28, monthlyCost: 22, strain: 24 } },
          { id: "event-stream", label: "Live event stream", subtitle: "Maintain a persistent stream for session-by-session race updates.", pro: "Near-real-time race changes", con: "Reconnect and ordering complexity", why: "This prioritizes live race moments over the simplicity of scheduled refreshes.", downstream: "The standings and prediction cache are recomputed whenever a streamed event is accepted.", impact: { latencyMs: 12, monthlyCost: 86, strain: 66 } },
        ],
      },
      {
        id: "standings-analysis", title: "Team ranking", options: [
          { id: "fia-form-index", label: "FIA points + form index", subtitle: "Rank teams by official points, then layer in rolling form and reliability.", pro: "Explainable team leaderboard", con: "Needs a few tuned weights", why: "This defines how raw race results become a team ranking that tells more than the official table.", downstream: "Each completed race updates points, recent finishing trend, DNF rate, and constructor momentum.", impact: { latencyMs: 24, monthlyCost: 18, strain: 28 } },
          { id: "elo-rating", label: "Elo-style team rating", subtitle: "Adjust a team strength rating after each race based on expected versus actual finish.", pro: "Captures momentum quickly", con: "Less intuitive to casual fans", why: "This uses performance surprise rather than only awarded points to measure team strength.", downstream: "The prediction engine consumes rating deltas and recent reliability as feature inputs.", impact: { latencyMs: 36, monthlyCost: 30, strain: 46 } },
        ],
      },
      {
        id: "race-forecast", title: "Winner forecast", options: [
          { id: "weighted-probability", label: "Explainable probability model", subtitle: "Score every team using form, circuit fit, reliability, and recent qualifying pace.", pro: "Shows fans why a team leads", con: "Weights need calibration", why: "This turns historical and current signals into a readable winning probability for the upcoming race.", downstream: "The UI can show each factor’s contribution alongside a ranked list of likely winners.", impact: { latencyMs: 38, monthlyCost: 28, strain: 38 } },
          { id: "trained-classifier", label: "Trained classifier", subtitle: "Train a model on prior race features to estimate the next winner.", pro: "Can learn non-obvious patterns", con: "Needs training data and monitoring", why: "This lets the forecast learn relationships between track, form, weather, and reliability from historical races.", downstream: "Feature pipelines, model versioning, and explanation safeguards become part of the system.", impact: { latencyMs: 118, monthlyCost: 190, strain: 74 } },
        ],
      },
      {
        id: "fan-experience", title: "Fan dashboard", options: [
          { id: "race-dashboard", label: "Live race dashboard", subtitle: "One place for scores, constructor standings, team form, and the next-race forecast.", pro: "Clear demo story", con: "Several views to design", why: "This decides how users move from score updates to an understandable team prediction.", downstream: "The web app reads cached standings and forecasts, then refreshes only the affected panels.", impact: { latencyMs: 18, monthlyCost: 34, strain: 30 } },
          { id: "weekly-brief", label: "Weekly race brief", subtitle: "Deliver a concise summary and prediction ahead of each Grand Prix.", pro: "Focused and easy to consume", con: "Less interactive exploration", why: "This narrows the experience to a repeatable pre-race decision moment.", downstream: "A scheduled job assembles standings movement and winner probabilities into a shareable brief.", impact: { latencyMs: 12, monthlyCost: 16, strain: 20 } },
        ],
      },
    ];
  }

  if (/product/i.test(graphName)) {
    return [
      { id: "landing-focus", title: "First screen", options: [
        { id: "next-race", label: "Next race focus", subtitle: "Lead with the upcoming Grand Prix, countdown, and likely winner.", pro: "Immediate reason to return", con: "Less championship context", why: "This chooses the next race as the product’s primary moment.", downstream: "Forecast and race schedule become the first data loaded for a visitor.", impact: { latencyMs: 18, monthlyCost: 12, strain: 18 } },
        { id: "season-overview", label: "Season overview", subtitle: "Lead with constructor standings and recent points movement.", pro: "Explains the championship", con: "Less timely between races", why: "This puts season narrative ahead of the next event.", downstream: "The landing view prioritizes standings, team momentum, and completed-race context.", impact: { latencyMs: 16, monthlyCost: 10, strain: 16 } },
      ] },
      { id: "team-comparison", title: "Compare teams", options: [
        { id: "form-cards", label: "Form comparison cards", subtitle: "Show points, podiums, DNFs, and recent pace side by side.", pro: "Fast to understand", con: "Less statistical depth", why: "This decides the evidence fans use to compare constructors.", downstream: "Team data is summarized into a small set of visual form signals.", impact: { latencyMs: 20, monthlyCost: 18, strain: 22 } },
        { id: "track-fit", label: "Track-fit comparison", subtitle: "Compare each team against the next circuit’s characteristics.", pro: "Makes forecasts feel specific", con: "Needs circuit attributes", why: "This makes the next race, not only season totals, central to comparison.", downstream: "Circuit type and team strength profiles feed the forecast explanation.", impact: { latencyMs: 34, monthlyCost: 30, strain: 42 } },
      ] },
      { id: "prediction-proof", title: "Explain the forecast", options: [
        { id: "factor-breakdown", label: "Factor breakdown", subtitle: "Show form, reliability, and circuit fit behind every probability.", pro: "Builds user trust", con: "Requires disciplined explanation", why: "This decides whether the prediction is a black box or a reasoned recommendation.", downstream: "The forecast service must return factor-level contributions, not only a winner.", impact: { latencyMs: 26, monthlyCost: 24, strain: 34 } },
        { id: "simple-pick", label: "Simple winner pick", subtitle: "Show a single favorite with a confidence label.", pro: "Very scannable", con: "Less credible to data fans", why: "This optimizes speed of comprehension over detailed evidence.", downstream: "Only the top-ranked team and confidence tier are rendered in the primary experience.", impact: { latencyMs: 12, monthlyCost: 12, strain: 16 } },
      ] },
    ];
  }

  return [
    { id: "problem", title: "Frame the problem", options: [
      { id: "data-overload", label: "Too much raw race data", subtitle: "Fans can find results, but not a clear explanation of team momentum.", pro: "Sharp user problem", con: "Needs a visible before-and-after", why: "This establishes why standings alone do not answer who is likely to win next.", downstream: "The pitch must demonstrate a move from raw results to a useful forecast.", impact: { latencyMs: 8, monthlyCost: 4, strain: 10 } },
      { id: "forecast-gap", label: "No transparent forecast", subtitle: "Fans get predictions but rarely see the reasoning behind them.", pro: "Strong AI story", con: "Sets a high explanation bar", why: "This positions explainability as the project’s difference.", downstream: "The demo needs to reveal the factors that changed a team’s winning chance.", impact: { latencyMs: 12, monthlyCost: 8, strain: 16 } },
    ] },
    { id: "demo", title: "Demo proof", options: [
      { id: "result-to-forecast", label: "Result to forecast", subtitle: "Update a race result and show standings plus the next-race probability change.", pro: "Proves the full loop", con: "Needs linked demo data", why: "This demonstrates that new results affect both the table and the forecast.", downstream: "The presentation sequence includes an update, recalculation, and explainable probability shift.", impact: { latencyMs: 24, monthlyCost: 20, strain: 26 } },
      { id: "team-deep-dive", label: "Team deep dive", subtitle: "Compare two teams and explain why one is favored at the next circuit.", pro: "Easy narrative", con: "Shows less system breadth", why: "This chooses a focused comparison as the core storytelling moment.", downstream: "The demo prioritizes team metrics, circuit fit, and a clear winner recommendation.", impact: { latencyMs: 18, monthlyCost: 14, strain: 20 } },
    ] },
    { id: "close", title: "Close the pitch", options: [
      { id: "fan-benefit", label: "Make race data useful", subtitle: "Help every fan understand what changed and who has the edge next.", pro: "Human and memorable", con: "Less technical detail", why: "This makes the outcome about better fan decisions, not model novelty.", downstream: "The closing screen connects the live data path to a simpler fan experience.", impact: { latencyMs: 10, monthlyCost: 8, strain: 12 } },
      { id: "builder-benefit", label: "Composable race intelligence", subtitle: "Show a clean pipeline from public F1 data to a product-ready forecast.", pro: "Strong technical story", con: "Less emotional", why: "This frames Webbed as an architecture tool and the F1 app as proof.", downstream: "The closing explains how each decision became an implementation-ready plan.", impact: { latencyMs: 14, monthlyCost: 12, strain: 18 } },
    ] },
  ];
}

function namespaceStages(graphId: string, stages: DecisionStage[]): DecisionStage[] {
  return stages.map((stage) => ({
    ...stage,
    id: `${graphId}-${stage.id}`,
    options: stage.options.map((option) => ({ ...option, id: `${graphId}-${option.id}` })),
  }));
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Generates a DecisionBlueprint whose stage count (3-5) and stage selection
 * are derived from the project idea + graph name, so the number of columns
 * genuinely varies with the input instead of always being the same fixed set.
 */
export function generateBlueprint(id: string, name: string, idea: string, dependsOn: string[]): DecisionBlueprint {
  if (/\b(formula\s*1|f1|grand prix)\b/i.test(idea)) {
    const stages = namespaceStages(id, formulaOneStages(name));
    return {
      id,
      name,
      purpose: `A decision path for ${name.toLowerCase()} in a Formula 1 scores, standings, and winner-prediction product.`,
      dependsOn,
      stages,
    };
  }

  const seedText = `${idea}::${name}`;
  const stageCount = 3 + (hashString(`${seedText}:count`) % 3);
  const offset = hashString(`${seedText}:offset`) % stageArchetypes.length;
  const chosen = Array.from(
    { length: stageCount },
    (_, index) => stageArchetypes[(offset + index) % stageArchetypes.length],
  );

  return {
    id,
    name,
    purpose: idea.trim()
      ? `Decisions that shape ${name.toLowerCase()} for "${idea.trim()}".`
      : `Explore the decisions that shape ${name.toLowerCase()}.`,
    dependsOn,
    stages: chosen.map((archetype, stageIndex) => ({
      id: `${id}-stage-${stageIndex}-${archetype.key}`,
      title: archetype.title,
      options: archetype.options.map((option, optionIndex) => ({
        id: `${id}-opt-${stageIndex}-${optionIndex}`,
        label: option.label,
        subtitle: option.subtitle,
        pro: option.pro,
        con: option.con,
        impact: decisionImpacts[archetype.key][optionIndex],
      })),
    })),
  };
}

export function generateBrief(idea: string): BriefSection[] {
  const trimmed = idea.trim() || "this project";
  return [
    { id: "problem", title: "Problem", body: `Without a clear plan, "${trimmed}" risks scattering effort across untested decisions.` },
    { id: "solution", title: "Solution", body: `A stage-by-stage architecture for "${trimmed}", built from the path chosen across each column.` },
    { id: "mvp", title: "MVP", body: "The currently active card in every stage below defines the minimum viable build." },
    { id: "demo", title: "Demo Moment", body: "Click any card in a column and watch the plan re-route forward to reflect the new choice." },
  ];
}

export function titleFromIdea(idea: string): string {
  const trimmed = idea.trim();
  if (!trimmed) return "Webbed Project";
  const words = trimmed.split(/\s+/).slice(0, 6).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
