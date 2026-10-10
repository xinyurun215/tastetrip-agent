import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_INPUT } from "../src/data.js";
import { detectConflicts } from "../src/pipeline/conflicts.js";
import { parseTastes } from "../src/pipeline/parse.js";
import { reorderRoute } from "../src/pipeline/reorder.js";
import { createMockClient } from "../src/qloo/mock.js";
import { replayResolve } from "../src/qloo/replay.js";

const LOCKED = ["对称旅馆大堂", "双柜台夜食堂", "爵士转角", "天台双银幕", "都会夜生活", "粉彩对称的旧世界"];

test("fixture replay for the demo pair differs from the locked itinerary", () => {
  const parsed = parseTastes(DEMO_INPUT);
  const insight = replayResolve(parsed);
  const conflicts = detectConflicts(parsed, insight);
  const route = reorderRoute(parsed, conflicts, insight);
  const body = JSON.stringify({ insight, conflicts, route });

  assert.equal(insight.fromQloo, true);
  assert.equal(insight.source, "replay");
  assert.equal(insight.entities.a[0].name, "The Grand Budapest Hotel");
  assert.equal(insight.entities.a[0].affinity, 0.22);
  assert.equal(insight.entities.a[0].sourceTag, "qloo:entity");
  assert.deepEqual(
    route.stops.map((stop) => stop.name),
    ["Szimpla Night Court", "Menza After Dark", "Instant Fogas", "Uránia Roof"],
  );
  assert.equal(route.stops[0].affinity, 0.84);
  assert.equal(route.name, "夜城交叉");
  assert.deepEqual(
    conflicts.map((conflict) => conflict.label),
    ["城市气质", "音乐场", "用餐方式"],
  );
  assert.equal(conflicts[0].a.title, "The Grand Budapest Hotel");
  assert.match(conflicts[0].a.detail, /affinity 0\.22/);
  assert.equal(conflicts[0].sourceTag, "qloo:replay");
  assert.equal(route.stops[0].sourceTag, "qloo:replay");
  assert.equal(route.stops[0].whySource, "qloo:replay");
  for (const name of LOCKED) assert.equal(body.includes(name), false, name);
  assert.equal(body.includes("mock:fixture"), false);
});

test("the no-graph baseline still returns the locked itinerary", async () => {
  const parsed = parseTastes(DEMO_INPUT);
  const insight = await createMockClient().resolvePair(parsed);
  const conflicts = detectConflicts(parsed, insight);
  const route = reorderRoute(parsed, conflicts, insight);
  assert.equal(insight.fromQloo, undefined);
  assert.equal(conflicts[0].a.title, "粉彩对称的旧世界");
  assert.equal(conflicts[0].sourceTag, "mock:fixture");
  assert.deepEqual(
    route.stops.map((stop) => stop.name),
    ["对称旅馆大堂", "双柜台夜食堂", "爵士转角 → 嘻哈地下室", "天台双银幕"],
  );
  assert.equal(route.stops[0].sourceTag, "mock:fixture");
  assert.equal(route.name, "都会夜生活");
});

test("an edited pair replays generic places instead of the locked stops", () => {
  const parsed = parseTastes({
    a: ["动漫", "摇滚", "拉面"],
    b: ["歌剧", "古典", "牛排"],
  });
  const insight = replayResolve(parsed);
  const route = reorderRoute(parsed, detectConflicts(parsed, insight), insight);
  assert.deepEqual(
    route.stops.map((stop) => stop.name),
    ["Night Ferry Bar", "Paper Lantern Canteen", "Low Room", "Signal Roof"],
  );
  assert.equal(JSON.stringify(route).includes("对称旅馆大堂"), false);
});
