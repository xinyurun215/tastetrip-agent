import assert from "node:assert/strict";
import test from "node:test";
import { planRoute } from "../src/pipeline/routePlanner.js";

const candidate = (id, scores, extra = {}) => ({
  id,
  name: id,
  scores,
  groupScore: Object.values(scores).reduce((sum, value) => sum + value, 0) / Object.keys(scores).length,
  sourceTag: "qloo:entity",
  durationMinutes: 30,
  ...extra,
});

test("plans a dynamic N=3 route with member scores, reasons, and source", () => {
  const result = planRoute({
    members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    context: { coordinates: { lat: 31.23, lng: 121.47 }, time: "18:00-22:00", budget: 300 },
    candidates: [
      candidate("p1", { m1: 0.8, m2: 0.7, m3: 0.9 }, { lat: 31.231, lng: 121.471, cost: 80 }),
      candidate("p2", { m1: 0.7, m2: 0.8, m3: 0.8 }, { lat: 31.24, lng: 121.48, cost: 90 }),
      candidate("p3", { m1: 0.6, m2: 0.9, m3: 0.8 }, { lat: 31.25, lng: 121.49, cost: 70 }),
    ],
  });
  assert.equal(result.stops.length, 3);
  assert.deepEqual(result.stops.map((stop) => stop.candidateId), ["p1", "p2", "p3"]);
  assert.deepEqual(result.stops[0].scores, { m1: 0.8, m2: 0.7, m3: 0.9 });
  assert.match(result.stops[0].reason, /m1|m2|m3/);
  assert.equal(result.stops[0].sourceTag, "qloo:entity");
  assert.equal(result.feasible, false);
  assert.equal(result.status, "needs_verification");
  assert.ok(result.unknownFields.includes("openingHours"));
  assert.ok(result.unknownFields.includes("travelMinutes"));
});

test("N=5 respects budget, time window, and hard rejection", () => {
  const members = ["m1", "m2", "m3", "m4", "m5"].map((id) => ({ id }));
  const result = planRoute({
    members,
    context: { time: "18:00-20:00", budget: 100 },
    candidates: [
      candidate("cheap", { m1: .9, m2: .9, m3: .8, m4: .8, m5: .9 }, { cost: 40, durationMinutes: 30, openAt: "17:00", closeAt: "21:00" }),
      candidate("closed", { m1: .95, m2: .95, m3: .95, m4: .95, m5: .95 }, { cost: 20, durationMinutes: 30, openAt: "21:00", closeAt: "23:00" }),
      candidate("rejected", { m1: .99, m2: .99, m3: .99, m4: .99, m5: .99 }, { cost: 20, tags: ["海鲜"], excluded: true, filterReasons: [{ type: "hard_rejection", memberId: "m2", rejection: "海鲜" }] }),
      candidate("expensive", { m1: .7, m2: .7, m3: .7, m4: .7, m5: .7 }, { cost: 80, durationMinutes: 30 }),
    ].map((item) => ({ ...item, travelMinutes: 5 })), // Explicit synthetic route facts, not coordinate estimates.
  });
  assert.deepEqual(result.stops.map((stop) => stop.candidateId), ["cheap"]);
  assert.equal(result.feasible, true);
  assert.equal(result.budget.within, true);
  assert.equal(result.evaluations.find((item) => item.candidateId === "closed").feasibility.withinTime, false);
  assert.equal(result.evaluations.find((item) => item.candidateId === "rejected").feasibility.hardRejected, true);
  assert.equal(result.evaluations.find((item) => item.candidateId === "expensive").feasibility.withinBudget, false);
});

test("uses coordinates for nearest order while movement remains unknown", () => {
  const result = planRoute({
    members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    context: { coordinates: { lat: 0, lng: 0 }, time: "09:00-18:00" },
    candidates: [
      candidate("far", { m1: .99, m2: .99, m3: .99 }, { lat: 0, lng: .03 }),
      candidate("near", { m1: .6, m2: .6, m3: .6 }, { lat: 0, lng: .01 }),
      candidate("next", { m1: .7, m2: .7, m3: .7 }, { lat: 0, lng: .02 }),
    ],
  });
  assert.deepEqual(result.stops.map((stop) => stop.candidateId), ["near", "next", "far"]);
  assert.ok(result.stops[0].distanceKm > 0);
  assert.equal(result.distanceKind, "straight_line");
  assert.equal(result.stops[0].moveMinutes, null);
  assert.equal(result.totalTravelMinutes, null);
  assert.equal(result.feasible, false);
});

test("degrades without coordinates and records the fallback reason", () => {
  const result = planRoute({
    members: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    context: { time: "18:00-22:00" },
    candidates: [
      candidate("low", { m1: .4, m2: .4, m3: .4 }),
      candidate("high", { m1: .9, m2: .8, m3: .9 }),
    ],
  });
  assert.deepEqual(result.stops.map((stop) => stop.candidateId), ["high", "low"]);
  assert.equal(result.locationMode, "unavailable");
  assert.match(result.reason, /坐标|位置/);
  assert.equal(result.stops[0].moveMinutes, null);
});
