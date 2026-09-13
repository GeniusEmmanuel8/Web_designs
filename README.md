# Web Design

Turn a project idea into editable decision graphs and a project brief.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

Add your Gemini API key to the local .env file. For Ollama generation and compatibility checks, run your signed-in Ollama instance on port 11434. The frontend starts at http://127.0.0.1:5177 and proxies API requests to port 8787. Keep .env private.

## Submission features

- Gemini and Ollama generate graphs from the project idea, graph name, and optional graph description.
- Select competing decisions, edit their details, and rewire connections.
- Add option creates an alternative in the selected stage. Insert step places a new stage after a selected node or into its forward connection, replaces the bypass, and shifts later columns.
- The left inspector explains decisions; the live brief and estimated route metrics follow the active choices.
- Projects save locally in this browser. Download JSON for an editable snapshot or export the brief.
- Gemini can finalize selected decisions into a build brief.
- Optional Backboard records decision events when BACKBOARD_API_KEY is configured.

Cost, latency, and strain are AI planning estimates, not measured infrastructure results. Generated provider names and capabilities need verification before implementation. A starter-plan indicator appears when generation fails.

AWS, Vultr, and Tiger Data integrations are not part of this submission.

## Checks

```bash
npm test
npm run build
```
