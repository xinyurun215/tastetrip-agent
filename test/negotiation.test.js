import assert from "node:assert/strict";
import test from "node:test";
import { applyNegotiationAction, startNegotiation } from "../src/pipeline/negotiation.js";

const members = [{ id: "m1" }, { id: "m2" }];
const candidates = [
  { id: "p1", name: "一号站", memberScores: { m1: 0.9, m2: 0.4 }, sourceTag: "qloo:entity" },
  { id: "p2", name: "二号站", memberScores: { m1: 0.5, m2: 0.9 }, sourceTag: "mock:fixture" },
  { id: "p3", name: "三号站", memberScores: { m1: 0.8, m2: 0.8 }, sourceTag: "qloo:entity" },
  { id: "blocked", memberScores: { m1: 1, m2: 1 }, excluded: true, filterReasons: [{ type: "hard_rejection", memberId: "m1" }] },
];

test("starts a traceable negotiation without mutating candidates", () => {
  const state = startNegotiation({ members, candidates, maxStops: 2 });
  assert.equal(state.round, 0);
  assert.deepEqual(state.selected.map((item) => item.id), ["p3", "p2"]);
  assert.equal(state.selected[0].sourceTag, "qloo:entity");
  assert.equal(state.remaining.some((item) => item.id === "blocked"), false);
  assert.equal(state.status, "partial");
  assert.equal(candidates[0].memberScores.m1, 0.9);
});

test("reject site removes only that candidate and records gain and concession", () => {
  const state = startNegotiation({ members, candidates, maxStops: 2 });
  const next = applyNegotiationAction(state, { type: "reject_site", candidateId: "p3" });
  assert.equal(next.round, 1);
  assert.deepEqual(next.selected.map((item) => item.id), ["p2", "p1"]);
  assert.equal(next.trace[0].action.type, "reject_site");
  assert.equal(next.trace[0].gained.candidateId, "p1");
  assert.equal(next.trace[0].conceded.candidateId, "p3");
  assert.equal(next.selected.some((item) => item.sourceTag === "qloo:entity"), true);
});

test("prioritizing a member raises the lowest satisfaction member weight", () => {
  const state = startNegotiation({ members, candidates, maxStops: 2 });
  const next = applyNegotiationAction(state, { type: "prioritize_member", memberId: "m2" });
  assert.equal(next.weights.m2 > state.weights.m2, true);
  assert.equal(next.trace[0].gained.memberId, "m2");
  assert.equal(next.trace[0].action.type, "prioritize_member");
});

test("shortening route keeps a local recomputation and never claims missing scores achieved", () => {
  const state = startNegotiation({
    members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    candidates: [{ id: "p1", memberScores: { m1: 0.8, m2: null } }, { id: "p2", memberScores: { m1: 0.7 } }],
    maxStops: 2,
  });
  const next = applyNegotiationAction(state, { type: "shorten_route", count: 1 });
  assert.equal(next.selected.length, 1);
  assert.equal(next.route.length, 1);
  assert.notEqual(next.status, "achieved");
  assert.equal(next.trace[0].action.type, "shorten_route");
});
