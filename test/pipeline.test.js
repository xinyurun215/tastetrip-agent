import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_INPUT, THREE_MEMBER_INPUT } from "../src/data.js";
import { parseTastes } from "../src/pipeline/parse.js";
import { detectConflicts } from "../src/pipeline/conflicts.js";
import { reorderRoute } from "../src/pipeline/reorder.js";

const DEMO = DEMO_INPUT;

test("canonical tastes conflict on city vibe and dining style", () => {
  const parsed = parseTastes(DEMO);
  const conflicts = detectConflicts(parsed);
  assert.deepEqual(
    conflicts.map((conflict) => conflict.labelEn),
    ["City vibe", "Dining style"],
  );
  assert.equal(conflicts[0].label, "城市气质");
  assert.equal(conflicts[1].label, "用餐方式");
  assert.equal(conflicts[0].a.title, "小众爵士的窄房间");
  assert.equal(conflicts[1].b.title, "只要夜宵");
});

test("matching food drops the dining conflict", () => {
  const parsed = parseTastes({
    a: ["《布达佩斯大饭店》", "爵士 Jazz", "寿司"],
    b: ["Marvel", "嘻哈 Hip-hop", "寿司"],
  });
  const conflicts = detectConflicts(parsed, { tensions: null });
  assert.deepEqual(
    conflicts.map((conflict) => conflict.label),
    ["城市气质"],
  );
});

test("identical tastes produce no conflict", () => {
  const parsed = parseTastes({
    a: ["同一部片", "同一首歌", "同一顿饭"],
    b: ["同一部片", "同一首歌", "同一顿饭"],
  });
  assert.deepEqual(detectConflicts(parsed), []);
});

test("reorder pieces the canonical pair into the night route", () => {
  const parsed = parseTastes(DEMO);
  const conflicts = detectConflicts(parsed);
  const route = reorderRoute(parsed, conflicts, { source: "mock" });
  assert.equal(route.name, "都会夜生活");
  assert.equal(route.nameEn, "Urban nightlife");
  assert.deepEqual(
    route.stops.map((stop) => stop.name),
    ["爵士窄门", "夜宵窗口", "只留一首", "热食收口"],
  );
  for (const stop of route.stops) {
    assert.ok(stop.whyBoth);
    assert.ok(stop.whyBothEn);
  }
});

test("reorder still explains why both like a non-canonical route", () => {
  const parsed = parseTastes({
    a: ["动漫", "摇滚", "拉面"],
    b: ["歌剧", "古典", "牛排"],
  });
  const conflicts = detectConflicts(parsed);
  const route = reorderRoute(parsed, conflicts, {
    source: "mock",
    overlap: { name: "都会夜生活", nameEn: "Urban nightlife" },
  });
  assert.equal(route.stops.length, 4);
  assert.match(route.stops[1].whyBoth, /拉面/);
  assert.match(route.stops[1].whyBoth, /牛排/);
  assert.equal(route.stops[0].name.includes("动漫"), true);
});

test("live stops show both side scores and the real gap", () => {
  const parsed = parseTastes(DEMO);
  const insight = {
    source: "live",
    fromQloo: true,
    overlap: { name: "New York City 夜路", nameEn: "New York City night" },
    entities: {
      a: [{ name: "Kamasi Washington" }],
      b: [{ name: "深夜食堂" }],
    },
    suggestions: [
      { name: "Village Vanguard", tags: ["Jazz Club"], affinityA: 0.22, affinityB: 0.71, city: "New York" },
      { name: "Late Ramen", tags: ["Restaurant"], affinityA: 0.4, affinityB: 0.41, city: "New York" },
    ],
  };
  const route = reorderRoute(parsed, [], insight);
  assert.equal(route.stops[0].name, "Late Ramen");
  assert.match(route.stops[0].whyBoth, /差 0\.01/);
  assert.match(route.stops[0].whyBoth, /不把分差写大/);
  assert.equal(route.stops[1].detail, "A 0.22 · B 0.71");
  assert.match(route.stops[1].whyBoth, /差 0\.49/);
  assert.match(route.stops[1].whyBoth, /Kamasi Washington/);
  assert.match(route.stops[1].whyBoth, /深夜食堂/);
  assert.match(route.stops[1].whyBoth, /Jazz Club/);
  assert.equal(route.stops[0].whyBoth === route.stops[1].whyBoth, false);
});

test("stops with coordinates walk to the nearest neighbor", () => {
  const parsed = parseTastes(DEMO);
  const insight = {
    source: "live",
    fromQloo: true,
    entities: { a: [{ name: "Kamasi Washington" }], b: [{ name: "深夜食堂" }] },
    suggestions: [
      { name: "Uptown", tags: ["Restaurant"], affinityA: 0.55, affinityB: 0.5, lat: 40.85, lng: -73.9 },
      { name: "Next Door", tags: ["Bar"], affinityA: 0.3, affinityB: 0.2, lat: 40.731, lng: -74.001 },
      { name: "Club", tags: ["Jazz Club"], affinityA: 0.61, affinityB: 0.6, lat: 40.73, lng: -74 },
    ],
  };
  const route = reorderRoute(parsed, [], insight);
  assert.deepEqual(
    route.stops.map((stop) => stop.name),
    ["Club", "Next Door", "Uptown"],
  );
  assert.equal(route.stops[0].lat, 40.73);
  assert.equal(route.stops[0].lng, -74);
});

test("blank taste fails before any reorder", () => {
  assert.throws(() => parseTastes({ a: ["", "爵士", "火锅"], b: DEMO.b }), /六项口味/);
});

test("members and context are normalized for an N=3 request", () => {
  const parsed = parseTastes(THREE_MEMBER_INPUT);
  assert.deepEqual(parsed.context, {
    city: "上海",
    start: "人民广场",
    time: "18:00-22:00",
    budget: 500,
    hardRejections: ["海鲜"],
    softPreferences: ["夜市", "现场音乐"],
  });
  assert.equal(parsed.members.length, 3);
  assert.deepEqual(parsed.members.map((member) => member.id), ["m1", "m2", "m3"]);
  assert.deepEqual(parsed.members[0].preferences.map((item) => item.value), ["电影", "爵士", "火锅"]);
  assert.deepEqual(parsed.members[0].hardRejections, ["海鲜"]);
  assert.deepEqual(parsed.members[0].softPreferences, ["现场音乐"]);
  assert.equal(parsed.members[0].constraints.start, "人民广场");
  assert.equal(parsed.a, undefined);
  assert.equal(parsed.b, undefined);
});

test("legacy A/B input keeps its compatibility projection", () => {
  const parsed = parseTastes(DEMO_INPUT);
  assert.equal(parsed.members.length, 2);
  assert.deepEqual(parsed.members.map((member) => member.id), ["a", "b"]);
  assert.deepEqual(parsed.a.map((item) => item.value), DEMO_INPUT.a);
  assert.deepEqual(parsed.b.map((item) => item.value), DEMO_INPUT.b);
});

test("empty members, missing preferences, and duplicate members are rejected", () => {
  assert.throws(() => parseTastes({ members: [], context: {} }), (error) => error.code === "EMPTY_MEMBERS");
  assert.throws(
    () => parseTastes({ members: [{ id: "m1", name: "甲" }], context: {} }),
    (error) => error.code === "MISSING_PREFERENCES",
  );
  assert.throws(
    () => parseTastes({ members: [{ id: "m1", name: "甲", preferences: THREE_MEMBER_INPUT.members[0].preferences }, { id: "m1", name: "乙", preferences: THREE_MEMBER_INPUT.members[1].preferences }], context: {} }),
    (error) => error.code === "DUPLICATE_MEMBER",
  );
});
