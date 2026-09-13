import test from "node:test";
import assert from "node:assert/strict";
import { rebuildRoutes, chooseNode, connectRoute, insertStep, removeNodes } from "../src/data/routing.ts";

function fixture() {
  const stages = ["a", "b", "c"].map((id) => ({ id, title: id, options: [{ id }, { id: `${id}2` }] }));
  const nodes = stages.flatMap((stage, index) => stage.options.map((option, row) => ({
    id: option.id, type: "decision", position: { x: index * 290, y: 88 + row * 210 },
    data: { groupId: stage.id, status: row ? "ghost" : "chosen" },
  })));
  return rebuildRoutes({ id: "g", stages, nodes, edges: [] });
}
const pairs = (graph) => graph.edges.map((edge) => `${edge.source}>${edge.target}`).sort();

test("inserting a step removes the old bypass and shifts complete columns", () => {
  const original = fixture();
  const graph = insertStep(original, "a", "new");
  assert.deepEqual(pairs(graph), ["a>new", "b>c", "new>b"]);
  assert.deepEqual(graph.stages.map((stage) => stage.id), ["a", "stage-new", "b", "c"]);
  assert.equal(graph.nodes.find((node) => node.id === "b2").position.x, 580);
  assert.equal(graph.nodes.find((node) => node.id === "new").position.y, 88);
  assert.deepEqual(pairs(original), ["a>b", "b>c"]);
});

test("insertion removes a manual bypass too", () => {
  const graph = connectRoute(fixture(), { id: "manual", source: "a", target: "b", data: { origin: "user" } });
  assert.deepEqual(pairs(insertStep(graph, "a", "new")), ["a>new", "b>c", "new>b"]);
});

test("rewiring selects the target sibling without duplicate connections", () => {
  let graph = connectRoute(fixture(), { id: "manual", source: "a", target: "b2", data: { origin: "user" } });
  assert.deepEqual(pairs(graph), ["a>b2", "b2>c"]);
  assert.equal(graph.nodes.find((node) => node.id === "b").data.status, "ghost");
  graph = chooseNode(graph, "b");
  assert.deepEqual(pairs(graph), ["a>b", "b>c"]);
});

test("deleting inserted steps reconnects their neighbors", () => {
  const graph = removeNodes(insertStep(fixture(), "a", "new"), new Set(["new"]));
  assert.deepEqual(pairs(graph), ["a>b", "b>c"]);
  assert.equal(graph.nodes.find((node) => node.id === "b").position.x, 290);
});

test("deleting a chosen option promotes its sibling", () => {
  const graph = removeNodes(fixture(), new Set(["b"]));
  assert.deepEqual(pairs(graph), ["a>b2", "b2>c"]);
  assert.deepEqual(graph.stages[1].options.map((option) => option.id), ["b2"]);
});

test("append and repeat insertion produce one continuous route", () => {
  const graph = insertStep(insertStep(fixture(), "c", "last"), "c", "middle");
  assert.deepEqual(pairs(graph), ["a>b", "b>c", "c>middle", "middle>last"]);
});
