import test from "node:test";
import assert from "node:assert/strict";
import { createHandoff } from "../src/data/handoff.ts";

test("handoff exports chosen decisions, descriptions, relationships and review state", () => {
  const graph = {
    id: "g", name: "Trust", description: "Explain delays", purpose: "Prediction choices", dependsOn: [],
    stages: [{ id: "s", title: "Explanation" }, { id: "empty", title: "Feedback" }],
    nodes: [
      { id: "a", position: { x: 100 }, data: { groupId: "s", status: "chosen", title: "Factors", subtitle: "Show contributing factors", pro: "Clear", con: "More space" } },
      { id: "b", data: { groupId: "s", status: "ghost", title: "Rejected option" } },
    ], edges: [{ source: "a", target: "b" }],
  };
  const project = { title: "Commuter", idea: "Predict delays", graphs: [graph] };
  const output = createHandoff(project, ["g"]);
  assert.equal(output.graphs[0].description, "Explain delays");
  assert.equal(output.graphs[0].status, "needs_review");
  assert.equal(output.graphs[0].decisions.length, 1);
  assert.deepEqual(output.graphs[0].unresolvedStages, ["Feedback"]);
  assert.deepEqual(output.graphs[0].connections, []);
  assert.ok(!JSON.stringify(output).includes("Rejected option"));
  assert.ok(!JSON.stringify(output).includes("position"));
  assert.equal(output.estimateAssumptions.measured, false);
  assert.equal(createHandoff(project, [], ["g"]).graphs[0].status, "generating");
});
