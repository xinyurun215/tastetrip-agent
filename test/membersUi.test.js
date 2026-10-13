import assert from "node:assert/strict";
import test from "node:test";
import { buildMembersRequest, scoreCell } from "../src/members.js";

test("buildMembersRequest keeps dynamic members and calls the explicit harness mode", () => {
  const request = buildMembersRequest([
    {
      id: "m1",
      name: "甲",
      preferences: ["电影", "爵士", "火锅"],
      city: "上海",
      start: "人民广场",
      time: "18:00-22:00",
      budget: "200",
    },
  ]);
  assert.equal(request.mode, "members-harness");
  assert.equal(request.members[0].constraints.city, "上海");
  assert.equal(request.members[0].constraints.budget, "200");
  assert.deepEqual(request.members[0].preferences, ["电影", "爵士", "火锅"]);
});

test("scoreCell renders unknown member affinity as an em dash", () => {
  assert.equal(scoreCell(null), "—");
  assert.equal(scoreCell(undefined), "—");
  assert.equal(scoreCell(0.875), "0.88");
});
