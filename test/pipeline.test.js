import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_INPUT } from "../src/data.js";
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
  assert.equal(conflicts[0].a.title, "粉彩对称的旧世界");
  assert.equal(conflicts[1].b.title, "台前精确的寿司");
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
    ["对称旅馆大堂", "双柜台夜食堂", "爵士转角 → 嘻哈地下室", "天台双银幕"],
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

test("blank taste fails before any reorder", () => {
  assert.throws(() => parseTastes({ a: ["", "爵士", "火锅"], b: DEMO.b }), /六项口味/);
});
