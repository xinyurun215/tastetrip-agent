import fixture from "../../fixtures/qloo/demo-pair.json" with { type: "json" };
import { interpret } from "./interpret.js";

function synthesize(query) {
  return {
    results: [
      {
        entity_id: `urn:entity:replay:${encodeURIComponent(query)}`,
        name: query,
        type: "urn:entity:tag",
        properties: {
          short_description: "Replay stand-in for a taste that is not in the recorded demo pair.",
        },
        popularity: 0.4,
        tags: [],
        query: { affinity: 0.36 },
      },
    ],
  };
}

export function replayResolve(parsed) {
  const known = (item) => Boolean(fixture.searches[item.value]);
  const demo = parsed.a.every(known) && parsed.b.every(known);
  const side = (items) =>
    items.map((item) => ({
      kind: item.key,
      query: item.value,
      search: fixture.searches[item.value] || synthesize(item.value),
    }));
  return interpret(
    {
      a: side(parsed.a),
      b: side(parsed.b),
      insights: demo ? fixture.insights.demo : fixture.insights.generic,
      relationships: demo ? fixture.insights.cross : null,
    },
    "replay",
  );
}
