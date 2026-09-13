import { createServer } from "node:http";
import { GoogleGenAI } from "@google/genai";


const port = Number(process.env.PORT ?? 8787);
const configuredGeminiModel = process.env.GEMINI_MODEL;
const permittedModels = new Set(["gemini-3.5-flash-lite", "gemini-3.5-flash"]);
const defaultModel = permittedModels.has(configuredGeminiModel) ? configuredGeminiModel : "gemini-3.5-flash-lite";
const ollamaUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const ollamaModel = process.env.OLLAMA_MODEL ?? "gpt-oss:20b-cloud";
const backboardApiKey = process.env.BACKBOARD_API_KEY;
const backboardAssistantId = process.env.BACKBOARD_ASSISTANT_ID;
const permittedOllamaModels = new Set(["gpt-oss:20b-cloud", "llama3.1:8b", "gemma3:4b"]);
const permittedRelations = new Set(["supports", "requires", "unlocks", "affects", "conflicts"]);

const integrations = { backboard: Boolean(backboardApiKey) };

const blueprintSchema = {
  type: "object",
  properties: {
    blueprints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          purpose: { type: "string" },
          stages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      subtitle: { type: "string" },
                      pro: { type: "string" },
                      con: { type: "string" },
                      why: { type: "string" },
                      downstream: { type: "string" },
                      impact: {
                        type: "object",
                        properties: {
                          latencyMs: { type: "integer", minimum: 1 },
                          monthlyCost: { type: "integer", minimum: 0 },
                          strain: { type: "integer", minimum: 1, maximum: 100 },
                        },
                        required: ["latencyMs", "monthlyCost", "strain"],
                      },
                    },
                    required: ["label", "subtitle", "pro", "con", "impact"],
                  },
                },
              },
              required: ["title", "options"],
            },
          },
        },
        required: ["purpose", "stages"],
      },
    },
  },
  required: ["blueprints"],
};

const briefSchema = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["title", "body"],
      },
    },
  },
  required: ["sections"],
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "http://127.0.0.1:5177",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 750_000) throw new Error("Request body is too large.");
  }
  return JSON.parse(body || "{}");
}

function integrationPayload() {
  return { backboard: { configured: integrations.backboard, purpose: "Decision memory" } };
}

async function inferSmallJson(prompt, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const ollamaResponse = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        think: "low",
        options: { temperature: 0 },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const result = await ollamaResponse.json();
    if (!ollamaResponse.ok) throw new Error(result?.error ?? "Ollama inference failed.");
    return {
      raw: parseModelJson(result?.message?.content),
      model: result.model ?? ollamaModel,
      provider: "Ollama",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`The AI returned an invalid ${field}.`);
  return value.trim();
}

function wholeNumber(value, field, minimum, maximum, fallback) {
  const numericValue = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numericValue)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`The AI returned an invalid ${field}.`);
  }
  return Math.min(maximum, Math.max(minimum, Math.round(numericValue)));
}

function toProjectBlueprints(raw, graphNames) {
  if (!raw || !Array.isArray(raw.blueprints) || raw.blueprints.length !== graphNames.length) {
    throw new Error("The AI returned an unexpected number of project webs.");
  }

  return raw.blueprints.map((blueprint, blueprintIndex) => {
    if (!blueprint || !Array.isArray(blueprint.stages) || blueprint.stages.length < 3 || blueprint.stages.length > 7) {
      throw new Error(`The AI returned an invalid stage plan for ${graphNames[blueprintIndex]}.`);
    }

    return {
      purpose: text(blueprint.purpose, "purpose"),
      stages: blueprint.stages.map((stage, stageIndex) => {
        if (!stage || !Array.isArray(stage.options) || stage.options.length < 2 || stage.options.length > 4) {
          throw new Error(`The AI returned invalid options for stage ${stageIndex + 1}.`);
        }

        return {
          id: `stage-${blueprintIndex}-${stageIndex}`,
          title: text(stage.title, "stage title"),
          options: stage.options.map((option, optionIndex) => ({
            id: `option-${blueprintIndex}-${stageIndex}-${optionIndex}`,
            label: text(option.label, "option label"),
            subtitle: text(option.subtitle, "option subtitle"),
            pro: text(option.pro, "option benefit"),
            con: text(option.con, "option trade-off"),
            ...(typeof option.why === "string" && option.why.trim() ? { why: option.why.trim() } : {}),
            ...(typeof option.downstream === "string" && option.downstream.trim() ? { downstream: option.downstream.trim() } : {}),
            impact: {
              latencyMs: wholeNumber(option.impact?.latencyMs, "latency estimate", 1, 10_000, 24 + stageIndex * 8 + optionIndex * 12),
              monthlyCost: wholeNumber(option.impact?.monthlyCost, "cost estimate", 0, 100_000, 20 + stageIndex * 18 + optionIndex * 25),
              strain: wholeNumber(option.impact?.strain, "strain estimate", 1, 100, 20 + stageIndex * 5 + optionIndex * 12),
            },
          })),
        };
      }),
    };
  });
}

function readGraphDescription(payload) {
  if (payload.graphDescription == null) return "";
  if (typeof payload.graphDescription !== "string" || payload.graphDescription.length > 2000) {
    throw new Error("Graph description must be text of at most 2000 characters.");
  }
  return payload.graphDescription.trim();
}

function graphProfile(graphName) {
  const name = graphName.toLowerCase();

  if (name.includes("product")) {
    return `You are a product designer. Create user-facing product decisions: who the product serves, the first valuable action, the core workflow, and how users understand or trust the result.
Never include data sources, APIs, databases, cloud infrastructure, frameworks, deployment, or model training. Those belong in Technical Build.`;
  }

  if (name.includes("technical")) {
    return `You are the lead system architect turning this exact product into a buildable implementation plan.
Work from the project's actual inputs to its actual user-facing output. The six stages must be in dependency order:
1. Real data origin: name relevant APIs, public datasets, sensors, files, or user-created data.
2. Acquisition and validation: name the protocol, schedule or stream, authentication, normalization, and failure strategy.
3. Storage and schema: name a concrete database or storage design and what records it holds.
4. Analysis or domain logic: name the algorithm, rules, features, calculations, or model that produces the product's core result.
5. Application delivery: name the backend/API and frontend mechanism that exposes that result to users.
6. Runtime and operations: name a concrete deployment approach, caching or jobs, and monitoring strategy.
Every option must answer how this particular project is built. Never use generic labels such as "Live API Feed", "Core Logic", "Learned Model", "Managed Cloud", "Direct Dashboard", or "Relational Database". Each option must name a real provider, protocol, technology, data structure, or algorithm. Rival options in one stage must solve the same problem and be substitutable choices, not sequential tasks.`;
  }

  if (name.includes("pitch") || name.includes("scope") || name.includes("description") || name.includes("brief")) {
    return `You are a hackathon product strategist. Create a project framing web that helps the team choose the target user, differentiated promise, MVP boundary, and demo moment.
Every option must be a genuine pitch or scope choice. Do not include technical architecture, data sources, APIs, databases, or deployment details.`;
  }

  return `Create decisions tailored to the stated graph function. Keep its decisions distinct from product UX, technical architecture, and pitch scope unless the graph function explicitly asks for one of those.`;
}

function graphDepthRules(graphName, depth) {
  if (depth !== "full" && !graphName.toLowerCase().includes("technical")) {
    return `- Each web has 3 or 4 left-to-right stages and exactly 2 genuinely rival, concrete decisions per stage.
- Keep output compact for an interactive canvas: labels max 4 words; subtitle, pro, and con max 10 words each.`;
  }

  const name = graphName.toLowerCase();
  if (name.includes("technical")) {
    return `- Create exactly 6 left-to-right stages covering the full build from real inputs to deployed user output.
- Each stage has exactly 2 concrete implementation alternatives. Name actual services, protocols, data formats, storage approaches, or algorithms.
- Stage titles describe the architectural responsibility; option labels name the concrete competing implementations.
- The selected option from stage N must produce what stage N+1 consumes.
- Do not place user personas, onboarding, feature prioritization, pitch language, or generic product UI choices in this graph.
- Do not collapse data acquisition, storage, analysis, backend delivery, and deployment into one generic node.`;
  }
  if (name.includes("product")) {
    return `- Create 5 or 6 left-to-right stages covering audience, entry experience, core workflow, major feature decisions, trust or explanation, and the return loop.
- Each stage has exactly 2 genuinely rival product approaches tailored to the idea.`;
  }
  return `- Create 4 or 5 left-to-right stages covering the complete graph function.
- Each stage has exactly 2 genuinely rival, project-specific decisions.`;
}

function architectPrompt({ idea, graphNames, graphDescription = "", depth = "compact" }) {
  const graphName = graphNames[0];
  return `You are Webbed, an AI product architect. Break the following project idea into a sequence of editable decision webs.

Project idea:
${idea}

Graph function:
${graphName}

User-defined graph scope:
${graphDescription || "Use the graph function above to determine its scope."}
Treat this scope as the specific requirements for this web. Cover its requested decisions, inputs, outputs, and exclusions. Tailor the stage titles and choices to it; do not substitute a generic template. Keep the JSON response contract below.

Specific instructions:
${graphProfile(graphName)}

Rules:
${graphDepthRules(graphName, depth)}
- Do not use generic filler such as "Core Logic" or "Data Source" without naming the actual technologies, data, or methods relevant to the idea.
- For technical webs, trace a real chain: data origin, ingestion/validation, storage or transformation, analysis/modeling, and delivery when relevant.
- The inspector uses the subtitle and trade-offs for added context. Do not add extra commentary.
- Impact values are rough hackathon planning estimates for the option alone: latency in milliseconds, monthly cost in USD, and architecture strain from 1 to 100.
- Make trade-offs honest. Do not invent live integrations, datasets, or dependencies that the option does not provide.
- Return only schema-compliant JSON.`;
}

function ollamaArchitectPrompt({ idea, graphNames, graphDescription = "" }) {
  return `${architectPrompt({ idea, graphNames, graphDescription, depth: "full" })}

For every option, also include:
- why: one sentence explaining what this choice decides and why it fits.
- downstream: one sentence explaining exactly what this choice changes in later stages.

Use this exact JSON structure:
{"blueprints":[{"purpose":"one concise sentence","stages":[{"title":"stage title","options":[{"label":"choice name","subtitle":"how it works","pro":"main benefit","con":"main trade-off","why":"what this decides","downstream":"what changes later","impact":{"latencyMs":1,"monthlyCost":0,"strain":1}}]}]}]}

Return one blueprint and no prose, markdown fences, IDs, or additional properties.`;
}

function parseModelJson(value) {
  const content = text(value, "model JSON response");
  try {
    return JSON.parse(content);
  } catch {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced.trim());
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(content.slice(start, end + 1));
    throw new Error("The model did not return valid JSON.");
  }
}

function routeImpactPrompt({ idea, graphName, path }) {
  return `You are the Webbed architecture impact engine. Estimate the selected architecture route for a hackathon project.

Project idea: ${idea}
Graph: ${graphName}
Selected route:
${path.map((item) => `- ${item.stage}: ${item.choice} (${item.detail})`).join("\n")}

Return JSON only with this exact shape:
{"latencyMs": number, "monthlyCost": number, "strain": number, "rationale": string}

Use rough monthly USD estimates for a small launched MVP. Strain is 1 to 100. Keep rationale under 16 words. Do not include markdown or any additional keys.`;
}

function edgeRelationPrompt({ idea, graphName, source, target }) {
  return `You are Webbed's architecture compatibility checker. Classify one directed connection a user just created.

Project: ${idea}
Graph: ${graphName}
Source decision: ${source.stage} — ${source.choice}: ${source.detail}
Target decision: ${target.stage} — ${target.choice}: ${target.detail}

Choose exactly one relation:
- supports: source is compatible with and beneficial to target, but optional
- requires: source cannot work as intended without target
- unlocks: source enables target to become possible
- affects: source changes target's behavior, cost, or complexity without requiring it
- conflicts: the choices are incompatible unless an adapter or explicit override is added

Return JSON only: {"relation":"supports|requires|unlocks|affects|conflicts","rationale":"one specific sentence under 20 words"}. Judge the actual named choices, not only their stage labels.`;
}

function impactFromOllama(raw) {
  return {
    latencyMs: wholeNumber(raw?.latencyMs, "Ollama latency estimate", 1, 10_000),
    monthlyCost: wholeNumber(raw?.monthlyCost, "Ollama cost estimate", 0, 100_000),
    strain: wholeNumber(raw?.strain, "Ollama strain estimate", 1, 100),
    rationale: text(raw?.rationale, "Ollama impact rationale"),
  };
}

function relationFromOllama(raw) {
  if (!permittedRelations.has(raw?.relation)) throw new Error("Ollama returned an invalid edge relationship.");
  return {
    relation: raw.relation,
    rationale: text(raw.rationale, "Ollama edge rationale"),
  };
}

function buildBriefPrompt({ idea, routes }) {
  return `You are Webbed, preparing a build-ready hackathon brief from a set of already-selected product decisions.

Project idea:
${idea}

Selected decision route:
${routes.map((route) => `${route.name}:\n${route.decisions.map((decision) => `- ${decision.stage}: ${decision.choice} — ${decision.detail}`).join("\n")}`).join("\n\n")}

Return exactly five concise sections as JSON:
1. Problem and audience
2. Product path
3. Technical plan
4. MVP build order
5. Demo story

Use the selected decisions as facts. Do not invent services, data sources, or capabilities that are absent from the route. Make the MVP build order practical for a hackathon.`;
}

function toBriefSections(raw) {
  if (!raw || !Array.isArray(raw.sections) || raw.sections.length !== 5) {
    throw new Error("Gemini returned an invalid build brief.");
  }
  return raw.sections.map((section, index) => ({
    id: `generated-${index}`,
    title: text(section?.title, "brief section title"),
    body: text(section?.body, "brief section body"),
  }));
}

async function assessRoute(request, response) {
  const payload = await readJson(request);
  const idea = text(payload.idea, "project idea");
  const graphName = text(payload.graphName, "graph name");
  if (!Array.isArray(payload.path) || payload.path.length < 2 || payload.path.length > 7) {
    throw new Error("Select a complete decision path before assessing impact.");
  }

  const path = payload.path.map((item) => ({
    stage: text(item?.stage, "path stage"),
    choice: text(item?.choice, "path choice"),
    detail: text(item?.detail, "path detail"),
  }));
  const result = await inferSmallJson(routeImpactPrompt({ idea, graphName, path }));
  sendJson(response, 200, { impact: impactFromOllama(result.raw), model: result.model, provider: result.provider });
}

async function generateBuildBrief(request, response) {
  const payload = await readJson(request);
  const idea = text(payload.idea, "project idea");
  if (!Array.isArray(payload.routes) || payload.routes.length < 1 || payload.routes.length > 6) {
    throw new Error("Select project decisions before generating a build brief.");
  }
  const routes = payload.routes.map((route) => {
    if (!Array.isArray(route?.decisions) || route.decisions.length < 2 || route.decisions.length > 7) {
      throw new Error("Gemini received an invalid selected route.");
    }
    return {
      name: text(route.name, "route name"),
      decisions: route.decisions.map((decision) => ({
        stage: text(decision?.stage, "decision stage"),
        choice: text(decision?.choice, "decision choice"),
        detail: text(decision?.detail, "decision detail"),
      })),
    };
  });
  const requestedModel = typeof payload.model === "string" ? payload.model : defaultModel;
  const model = permittedModels.has(requestedModel) ? requestedModel : defaultModel;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const interaction = await ai.interactions.create({
    model,
    input: buildBriefPrompt({ idea, routes }),
    store: false,
    response_format: { type: "text", mime_type: "application/json", schema: briefSchema },
  });
  sendJson(response, 200, { sections: toBriefSections(JSON.parse(interaction.output_text ?? "{}")), model });
}

async function generateOllamaBlueprint(request, response) {
  const payload = await readJson(request);
  const idea = text(payload.idea, "project idea");
  const graphNames = Array.isArray(payload.graphNames)
    ? payload.graphNames.map((name) => text(name, "graph function"))
    : [];
  if (graphNames.length !== 1) throw new Error("Generate one graph at a time.");
  const requestedModel = typeof payload.model === "string" ? payload.model : ollamaModel;
  const model = permittedOllamaModels.has(requestedModel) ? requestedModel : ollamaModel;
  const controller = new AbortController();
  const isTechnicalGraph = graphNames[0].toLowerCase().includes("technical");
  const timeout = setTimeout(() => controller.abort(), isTechnicalGraph ? 90_000 : 60_000);

  try {
    const ollamaResponse = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        ...(model.startsWith("gpt-oss") ? { think: "low" } : {}),
        format: blueprintSchema,
        options: { temperature: 0.05, num_predict: isTechnicalGraph ? 2600 : 2200 },
        messages: [{ role: "user", content: ollamaArchitectPrompt({ idea, graphNames, graphDescription: readGraphDescription(payload) }) }],
      }),
    });
    const result = await ollamaResponse.json();
    if (!ollamaResponse.ok) throw new Error(result?.error ?? "Ollama did not generate a blueprint.");
    const blueprints = toProjectBlueprints(parseModelJson(result?.message?.content), graphNames);
    sendJson(response, 200, { blueprints, model: result.model ?? model });
  } finally {
    clearTimeout(timeout);
  }
}

async function validateEdge(request, response) {
  const payload = await readJson(request);
  const idea = text(payload.idea, "project idea");
  const graphName = text(payload.graphName, "graph name");
  const source = {
    stage: text(payload.source?.stage, "source stage"),
    choice: text(payload.source?.choice, "source choice"),
    detail: text(payload.source?.detail, "source detail"),
  };
  const target = {
    stage: text(payload.target?.stage, "target stage"),
    choice: text(payload.target?.choice, "target choice"),
    detail: text(payload.target?.detail, "target detail"),
  };
  const result = await inferSmallJson(edgeRelationPrompt({ idea, graphName, source, target }));
  sendJson(response, 200, { ...relationFromOllama(result.raw), model: result.model, provider: result.provider });
}

async function writeBackboardMemory(event, threadId) {
  const body = {
    ...(threadId ? { thread_id: threadId } : {}),
    ...(backboardAssistantId ? { assistant_id: backboardAssistantId } : {}),
    content: `Webbed project "${event.projectTitle}" recorded a ${event.eventType} event in ${event.graphName}: ${event.detail}`,
    memory: "Auto",
    send_to_llm: "false",
    stream: false,
    metadata: {
      source: "webbed",
      project_id: event.projectId,
      graph_name: event.graphName,
      event_type: event.eventType,
      ...event.metadata,
    },
  };
  const backboardResponse = await fetch("https://app.backboard.io/api/threads/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": backboardApiKey },
    body: JSON.stringify(body),
  });
  const result = await backboardResponse.json();
  if (!backboardResponse.ok) throw new Error(result?.detail ?? result?.message ?? "Backboard memory write failed.");
  return { stored: true, threadId: result.thread_id };
}

async function recordDecisionEvent(request, response) {
  const payload = await readJson(request);
  const event = {
    projectId: text(payload.projectId, "project id"),
    projectTitle: text(payload.projectTitle, "project title"),
    graphName: text(payload.graphName, "graph name"),
    eventType: text(payload.eventType, "event type"),
    detail: text(payload.detail, "event detail"),
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
  };

  const backboardResult = integrations.backboard
    ? await writeBackboardMemory(event, typeof payload.backboardThreadId === "string" ? payload.backboardThreadId : undefined)
      .catch((error) => ({ stored: false, error: error instanceof Error ? error.message : "Backboard memory write failed." }))
    : { stored: false, reason: "not configured" };

  sendJson(response, 200, { backboard: backboardResult });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  const pathname = url.pathname;

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "http://127.0.0.1:5177",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && pathname === "/api/integrations") {
    sendJson(response, 200, { integrations: integrationPayload() });
    return;
  }

  if (request.method !== "POST" || !["/api/blueprints", "/api/ollama/blueprints", "/api/impact", "/api/edge", "/api/brief", "/api/events"].includes(pathname)) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  if (pathname === "/api/events") {
    try {
      await recordDecisionEvent(request, response);
    } catch (error) {
      sendJson(response, 502, { error: error instanceof Error ? error.message : "Decision event write failed." });
    }
    return;
  }

  if (pathname === "/api/impact") {
    try {
      await assessRoute(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ollama impact assessment failed.";
      console.warn("Webbed Ollama assessment unavailable:", message);
      sendJson(response, 502, { error: message });
    }
    return;
  }

  if (pathname === "/api/edge") {
    try {
      await validateEdge(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ollama edge validation failed.";
      console.warn("Webbed Ollama edge validation unavailable:", message);
      sendJson(response, 502, { error: message });
    }
    return;
  }

  if (pathname === "/api/ollama/blueprints") {
    try {
      await generateOllamaBlueprint(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ollama blueprint generation failed.";
      console.error("Webbed Ollama blueprint generation failed:", message);
      sendJson(response, 502, { error: message });
    }
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    sendJson(response, 503, { error: "Gemini is not configured. Add GEMINI_API_KEY to .env, then restart npm run dev." });
    return;
  }

  if (pathname === "/api/brief") {
    try {
      await generateBuildBrief(request, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini build brief generation failed.";
      console.error("Webbed Gemini build brief failed:", message);
      sendJson(response, 502, { error: message });
    }
    return;
  }

  try {
    const payload = await readJson(request);
    const idea = text(payload.idea, "project idea");
    const graphNames = Array.isArray(payload.graphNames)
      ? payload.graphNames.map((name) => text(name, "graph function"))
      : [];
    if (graphNames.length === 0 || graphNames.length > 1) throw new Error("Generate one graph at a time.");
    const requestedModel = typeof payload.model === "string" ? payload.model : defaultModel;
    const model = permittedModels.has(requestedModel) ? requestedModel : defaultModel;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const interaction = await ai.interactions.create({
      model,
      input: architectPrompt({ idea, graphNames, graphDescription: readGraphDescription(payload) }),
      store: false,
      response_format: { type: "text", mime_type: "application/json", schema: blueprintSchema },
    });
    const blueprints = toProjectBlueprints(JSON.parse(interaction.output_text ?? "{}"), graphNames);
    sendJson(response, 200, { blueprints, model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini generation failed.";
    console.error("Webbed Gemini generation failed:", message);
    sendJson(response, 502, { error: message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Webbed API listening on http://127.0.0.1:${port}`);
});
