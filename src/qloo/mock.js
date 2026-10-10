import { isCanonicalPair } from "../pipeline/conflicts.js";
import { CANONICAL } from "../data.js";

function entitiesFor(side) {
  return side.map((item) => ({
    id: `mock:${item.value}`,
    name: item.value,
    kind: item.key,
    query: item.value,
    source: "mock",
  }));
}

export function createMockClient() {
  return {
    async resolvePair(parsed) {
      const canonical = isCanonicalPair(parsed);
      return {
        source: "mock",
        warning: null,
        cached: false,
        entities: {
          a: entitiesFor(parsed.a),
          b: entitiesFor(parsed.b),
        },
        suggestions: [],
        tensions: canonical ? CANONICAL.conflicts : null,
        overlap: {
          name: "都会夜生活",
          nameEn: "Urban nightlife",
        },
      };
    },
  };
}
