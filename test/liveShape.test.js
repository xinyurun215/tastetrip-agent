import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_INPUT } from "../src/data.js";
import { detectConflicts } from "../src/pipeline/conflicts.js";
import { parseTastes } from "../src/pipeline/parse.js";
import { reorderRoute } from "../src/pipeline/reorder.js";
import { createMockClient } from "../src/qloo/mock.js";
import { interpret } from "../src/qloo/interpret.js";

const LOCKED = ["对称旅馆大堂", "双柜台夜食堂", "爵士转角", "天台双银幕", "都会夜生活", "粉彩对称的旧世界"];

function search(name, id, affinity) {
  return {
    results: [
      {
        entity_id: id,
        name,
        type: "urn:entity:movie",
        query: { affinity },
      },
    ],
  };
}

test("a live-shaped payload reorders away from the locked itinerary", () => {
  const parsed = parseTastes(DEMO_INPUT);
  const insight = interpret({
    a: [
      { kind: "work", query: DEMO_INPUT.a[0], search: search("The Grand Budapest Hotel", "urn:entity:movie:gbh", 0.22) },
      { kind: "music", query: DEMO_INPUT.a[1], search: search("Jazz", "urn:entity:artist:jazz", 0.41) },
      { kind: "food", query: DEMO_INPUT.a[2], search: search("Hot pot", "urn:entity:place:hot-pot", 0.27) },
    ],
    b: [
      { kind: "work", query: DEMO_INPUT.b[0], search: search("Marvel Cinematic Universe", "urn:entity:brand:mcu", 0.18) },
      { kind: "music", query: DEMO_INPUT.b[1], search: search("Hip hop", "urn:entity:artist:hip-hop", 0.33) },
      { kind: "food", query: DEMO_INPUT.b[2], search: search("Sushi", "urn:entity:place:sushi", 0.24) },
    ],
    insights: {
      results: {
        entities: [
          { entity_id: "urn:entity:place:night-counter", name: "Night counter", type: "urn:entity:place", query: { affinity: 0.84 } },
          { entity_id: "urn:entity:place:late-room", name: "Late Room", type: "urn:entity:place", query: { affinity: 0.71 } },
        ],
      },
    },
    relationships: {
      results: {
        entities: [{ entity_id: "urn:entity:movie:gbh", name: "The Grand Budapest Hotel", query: { affinity: 0.19 } }],
      },
    },
  });
  const conflicts = detectConflicts(parsed, insight);
  const route = reorderRoute(parsed, conflicts, insight);
  const body = JSON.stringify({ insight, conflicts, route });
  assert.equal(insight.source, "live");
  assert.equal(insight.entities.a[0].affinity, 0.19);
  assert.equal(route.stops[0].name, "Night counter");
  assert.equal(route.stops[0].affinity, 0.84);
  assert.equal(route.stops[0].sourceTag, "qloo:entity");
  assert.equal(route.stops[0].whySource, "qloo:entity");
  assert.equal(conflicts[0].a.title, "The Grand Budapest Hotel");
  assert.equal(conflicts[0].sourceTag, "qloo:entity");
  assert.match(conflicts[0].a.detail, /affinity 0\.19/);
  for (const name of LOCKED) assert.equal(body.includes(name), false, name);
  assert.equal(body.includes("mock:fixture"), false);
  assert.equal(body.includes("qloo:replay"), false);
});

test("the no-graph baseline still returns the locked itinerary", async () => {
  const parsed = parseTastes(DEMO_INPUT);
  const insight = await createMockClient().resolvePair(parsed);
  const conflicts = detectConflicts(parsed, insight);
  const route = reorderRoute(parsed, conflicts, insight);
  assert.equal(conflicts[0].a.title, "小众爵士的窄房间");
  assert.equal(conflicts[0].sourceTag, "mock:fixture");
  assert.equal(route.name, "都会夜生活");
  assert.equal(route.stops[0].name, "爵士窄门");
  assert.equal(route.stops[0].sourceTag, "mock:fixture");
});
