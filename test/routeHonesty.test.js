import assert from "node:assert/strict";
import test from "node:test";
import { planRoute } from "../src/pipeline/routePlanner.js";

// Synthetic, fully specified facts; no external place or routing data.
const place = (id, extra = {}) => ({
  id, name: id, cost: 10, durationMinutes: 30, travelMinutes: 5,
  openingHours: "09:00-18:00", sourceTag: "mock:fixture", ...extra,
});
const route = (candidates, extra = {}) => planRoute({
  context: { time: "10:00-17:00", budget: 100 },
  candidates, preserveOrder: true, ...extra,
});

test("missing price, hours and movement keep a draft without claiming feasibility", () => {
  const result = route([{ id: "unknown", durationMinutes: 30 }]);
  assert.equal(result.stops.length, 1);
  assert.equal(result.feasible, false);
  assert.equal(result.status, "needs_verification");
  assert.equal(result.reasonCode, "missing_facts");
  for (const field of ["cost", "openingHours", "travelMinutes", "schedule"]) {
    assert.ok(result.unknownFields.includes(field), field);
  }
  assert.equal(result.stops[0].cost, null);
  assert.equal(result.stops[0].feasibility.withinOpening, null);
  assert.equal(result.stops[0].feasibility.withinTime, null);
  assert.equal(result.budget.within, null);
  assert.equal(result.totalCost, null);
  assert.equal(result.budget.remaining, null);
  assert.equal(result.totalTravelMinutes, null);
});

test("price levels, estimates and price ranges cannot become actual prices", () => {
  for (const extra of [{ priceLevel: 3 }, { estimatedCost: 20 }, { price: "$20–50" }]) {
    const result = route([place("a", { cost: undefined, ...extra })]);
    assert.equal(result.stops[0].cost, null);
    assert.equal(result.feasible, false);
    assert.ok(result.unknownFields.includes("cost"));
  }
  const free = route([place("free", { cost: 0 })]);
  assert.equal(free.totalCost, 0);
  assert.equal(free.feasible, true);
});

test("coordinates only order stops and cannot fill unknown travel or downstream times", () => {
  const result = route([
    place("a", { lat: 0, lng: 0.01, travelMinutes: undefined }),
    place("b", { lat: 0, lng: 0.02 }),
  ], { context: { coordinates: { lat: 0, lng: 0 }, time: "10:00-17:00", travelMinutesPerKm: 1 } });
  assert.ok(result.stops[0].distanceKm > 0);
  assert.equal(result.distanceKind, "straight_line");
  assert.equal(result.stops[0].moveMinutes, null);
  assert.equal(result.stops[1].moveMinutes, 5);
  assert.deepEqual(result.stops.map((stop) => stop.time), [null, null]);
  assert.deepEqual(result.stops.map((stop) => stop.finish), [null, null]);
  assert.equal(result.time.finish, null);
  assert.equal(result.totalTravelMinutes, null);
  assert.equal(result.feasible, false);
});

test("missing opening hours leave downstream timing unknown", () => {
  const result = route([place("a", { openingHours: undefined }), place("b")]);
  assert.equal(result.stops[0].feasibility.withinOpening, null);
  assert.equal(result.stops[0].finish, null);
  assert.equal(result.stops[1].time, null);
  assert.equal(result.feasible, false);
});

test("default stay duration remains an explicit assumption and does not prove timing", () => {
  const result = route([place("a", { durationMinutes: undefined }), place("b")]);
  assert.equal(result.stops[0].durationMinutes, 60);
  assert.equal(result.stops[0].durationAssumed, true);
  assert.ok(result.stops[0].unknownFields.includes("durationMinutes"));
  assert.equal(result.stops[0].finish, null);
  assert.equal(result.stops[1].time, null);
  assert.equal(result.feasible, false);
});

test("nonoverlapping member windows block the route even within the group window", () => {
  const result = route([place("a")], {
    members: [{ id: "a", context: { time: "10:00-11:00" } }, { id: "b", constraints: { time: "12:00-13:00" } }],
  });
  assert.equal(result.feasible, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "no_common_time");
  assert.equal(result.feasibility.withinTime, false);
  assert.deepEqual(result.stops, []);
});

test("member windows intersect with the group window before known facts are checked", () => {
  const result = route([place("a"), place("b")], {
    members: [{ id: "a", time: "11:00-14:00" }, { id: "b", constraints: { time: "12:00-15:00" } }],
  });
  assert.equal(result.time.start, "12:00");
  assert.equal(result.time.end, "14:00");
  assert.equal(result.time.finish, "13:10");
  assert.equal(result.feasible, true);
  assert.equal(result.status, "verified");
  assert.deepEqual(result.unknownFields, []);
  assert.equal(result.totalTravelMinutes, 10);
  assert.equal(result.totalCost, 20);
});

test("travel facts bound to a different predecessor become unknown after replacement", () => {
  const result = route([
    place("replacement", { travelFromId: "start" }),
    place("b", { travelFromId: "removed" }),
    place("c", { travelFromId: "b" }),
  ]);
  assert.equal(result.stops[0].moveMinutes, 5);
  assert.equal(result.stops[1].moveMinutes, null);
  assert.equal(result.stops[2].moveMinutes, 5);
  assert.equal(result.stops[2].time, null);
  assert.equal(result.feasible, false);
});

test("an unknown price cannot erase a later known budget violation", () => {
  const result = route([place("unknown", { cost: undefined }), place("costly", { cost: 101 })]);
  assert.deepEqual(result.stops.map((stop) => stop.id), ["unknown"]);
  assert.equal(result.evaluations[1].feasibility.withinBudget, false);
  assert.equal(result.evaluations[1].reasonCode, "over_budget");
  assert.equal(result.totalCost, null);
  assert.equal(result.feasible, false);
});
