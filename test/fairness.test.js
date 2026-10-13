import assert from "node:assert/strict";
import test from "node:test";
import { scoreFairness } from "../src/pipeline/fairness.js";

const member = (id, hardRejections = []) => ({ id, name: id, hardRejections });
const place = (id, memberScores, extra = {}) => ({ id, name: id, memberScores, ...extra });

test("scores an N=3 candidate matrix with average, minimum, disagreement, and source", () => {
  const result = scoreFairness(
    [member("m1"), member("m2"), member("m3")],
    [place("p1", { m1: 0.9, m2: 0.7, m3: 0.8 }, { sourceTag: "qloo:entity" })],
  );
  assert.deepEqual(result.scoreMatrix[0].scores, { m1: 0.9, m2: 0.7, m3: 0.8 });
  assert.equal(result.candidates[0].averageSatisfaction, 0.8);
  assert.equal(result.candidates[0].minimumSatisfaction, 0.7);
  assert.equal(result.candidates[0].disagreement, 0.2);
  assert.equal(result.candidates[0].groupScore, 1.3);
  assert.equal(result.candidates[0].sourceTag, "qloo:entity");
  assert.deepEqual(result.accepted.map((candidate) => candidate.id), ["p1"]);
});

test("N=5 keeps missing Qloo affinity as null and excludes it from metrics", () => {
  const members = ["m1", "m2", "m3", "m4", "m5"].map((id) => member(id));
  const result = scoreFairness(members, [place("p1", { m1: 0.8, m2: null, m3: 0.6, m4: undefined, m5: 0.7 }, { sourceTag: "qloo:entity" })]);
  assert.deepEqual(result.scoreMatrix[0].scores, { m1: 0.8, m2: null, m3: 0.6, m4: null, m5: 0.7 });
  assert.equal(result.candidates[0].averageSatisfaction, 0.7);
  assert.equal(result.candidates[0].minimumSatisfaction, 0.6);
  assert.equal(result.candidates[0].disagreement, 0.2);
  assert.equal(result.candidates[0].groupScore, 1.1);
  assert.equal(result.candidates[0].scoreCoverage, 3 / 5);
});

test("hard rejection removes a candidate and records the member and match", () => {
  const result = scoreFairness(
    [member("m1", ["海鲜"]), member("m2") , member("m3")],
    [place("p1", { m1: 0.9, m2: 0.8, m3: 0.7 }, { tags: ["海鲜", "餐厅"], sourceTag: "qloo:entity" })],
  );
  assert.equal(result.candidates[0].excluded, true);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.filtered.length, 1);
  assert.deepEqual(result.candidates[0].filterReasons, [{ type: "hard_rejection", memberId: "m1", rejection: "海鲜", matched: ["海鲜"] }]);
  assert.equal(result.candidates[0].sourceTag, "qloo:entity");
});

test("fallback source stays traceable when scoring member suggestions", () => {
  const result = scoreFairness(
    [member("m1"), member("m2"), member("m3")],
    [place("p1", { m1: 0.5 }, { sourceTag: "mock:fixture" })],
  );
  assert.equal(result.candidates[0].sourceTag, "mock:fixture");
  assert.equal(result.candidates[0].scores.m2, null);
  assert.equal(result.candidates[0].minimumSatisfaction, 0.5);
  assert.equal(result.candidates[0].groupScore, 1);
});


