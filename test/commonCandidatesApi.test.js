import assert from "node:assert/strict";
import test from "node:test";
import { handleQlooRequest } from "../server/handleQloo.js";

// All entities, identifiers, scores and explanations below are synthetic.
// These fixtures test the API contract, not real Qloo quality or satisfaction.
const KEY = "synthetic-test-key-not-a-credential";
const context = { city: "Synthetic City", coordinates: { lat: 40, lng: -73, radiusM: 12000 } };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const entity = (id, kind, extra = {}) => ({ entity_id: id, name: `Synthetic ${id}`, types: [`urn:entity:${kind}`], ...extra });
const place = (id, extra = {}) => entity(id, "place", { location: { lat: 40.01, lon: -73.01 }, properties: { address: `${id} Example Street`, external: { google_places: [{ id: `synthetic-google-${id}` }] } }, ...extra });
const members = [
  { id: "a", name: "A", entities: [{ id: "movie:a", kind: "movie", name: "Untrusted submitted name" }] },
  { id: "b", name: "B", entities: [{ id: "artist:b", kind: "artist" }, { id: "book:b", kind: "book" }] },
  { id: "c", name: "C", entities: [] },
];
const confirmed = [entity("movie:a", "movie"), entity("artist:b", "artist"), entity("book:b", "book")];
const compareBody = (extra = {}) => ({ mode: "common-compare", context, members, ...extra });
const explained = (id, affinity, signal = "movie:a") => ({ ...place(id), query: { affinity, explainability: { "signal.interests.entities": [{ entity_id: signal, score: 0.7 }] } } });
function fixtureFetch({ pool = [place("p1"), place("p2")], details = confirmed, search = [], ranks } = {}) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url) {
      const u = new URL(url); calls.push(u);
      if (u.pathname === "/entities") return json({ results: { entities: details } });
      if (u.pathname === "/search") return json({ results: search });
      if (u.pathname === "/v2/insights" && !u.searchParams.has("filter.results.entities")) return json({ results: { entities: pool } });
      if (u.pathname === "/v2/insights") {
        const signal = u.searchParams.get("signal.interests.entities");
        return json({ results: { entities: ranks?.[signal] || [explained("p1", 0.8, signal), explained("p2", 0.4, signal)] } });
      }
      throw new Error(`Unexpected synthetic request ${u.pathname}`);
    },
  };
}
async function run(body, fixture = fixtureFetch(), extra = {}) {
  const result = await handleQlooRequest(body, { env: { QLOO_API_KEY: KEY }, cache: new Map(), ...fixture, ...extra });
  assert.equal(JSON.stringify(result).includes(KEY), false);
  return result;
}

test("common search accepts free text and blank optional categories without selecting an ambiguous entity", async () => {
  const external = { imdb: [{ id: "synthetic-imdb-1" }] };
  const fixture = fixtureFetch({ search: [
    entity("movie:one", "movie", { name: "Same title", disambiguation: "Synthetic original", properties: { release_year: 1990, external } }),
    entity("movie:two", "movie", { name: "Same title", properties: { release_year: 2020 } }),
    entity("wrong", "book"),
  ] });
  const result = await run({ mode: "common-search", members: [
    { id: "a", name: "A", preferences: [{ kind: "movie", query: "  Same title!  " }, { kind: "artist", query: "  " }] },
    { id: "b", name: "B", preferences: [] },
  ] }, fixture);
  assert.equal(result.ok, true);
  assert.equal(result.insight.source, "live");
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].searchParams.get("types"), "urn:entity:movie");
  assert.equal(fixture.calls[0].searchParams.get("query"), "Same title!");
  assert.equal(fixture.calls[0].searchParams.get("sort_by"), "match");
  const preference = result.insight.members[0].preferences[0];
  assert.equal(preference.query, "Same title!");
  assert.deepEqual(preference.matches.map((m) => m.id), ["movie:one", "movie:two"]);
  assert.deepEqual(preference.matches[0].external, external);
  assert.equal(preference.matches[0].year, 1990);
  assert.equal(preference.matches[0].disambiguation, "Synthetic original");
  assert.equal(preference.matches[0].sourceTag, "qloo:entity");
  assert.equal(preference.selected, undefined);
  assert.deepEqual(result.insight.members[1].preferences, []);
});

test("book confirmation preserves source ISBN and all types even when requested kind is not first", async () => {
  const fixture = fixtureFetch({ search: [entity("book:one", "book", { types: ["urn:entity:work", "urn:entity:book"], properties: { publication_year: 1988, external: { isbn13: [{ id: "9780000000002" }] } } })] });
  const result = await run({ mode: "common-search", members: [{ id: "a", preferences: [{ kind: "book", query: "Synthetic book" }] }] }, fixture);
  assert.equal(result.ok, true);
  assert.deepEqual(result.insight.members[0].preferences[0].matches[0].types, ["urn:entity:work", "urn:entity:book"]);
  assert.deepEqual(result.insight.members[0].preferences[0].matches[0].isbn13, ["9780000000002"]);
});

test("common modes without a server key are unavailable and do not invent matches or rankings", async () => {
  const fixture = fixtureFetch();
  const result = await run(compareBody(), fixture, { env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_key");
  assert.equal(result.insight.source, "unavailable");
  assert.equal(result.insight.fromQloo, false);
  assert.deepEqual(result.insight.pool, []);
  assert.deepEqual(result.insight.rankings, []);
  assert.equal(fixture.calls.length, 0);
});

test("common compare verifies IDs then uses one geographic candidate pool for each signalled member", async () => {
  const fixture = fixtureFetch({ ranks: {
    "movie:a": [explained("p1", 0.8), explained("p2", 0.2)],
    "artist:b,book:b": [explained("p2", 0.9, "artist:b"), { ...place("p1"), query: { affinity: 0.4 } }],
  } });
  const result = await run(compareBody(), fixture);
  assert.equal(result.ok, true);
  assert.equal(fixture.calls[0].pathname, "/entities");
  assert.equal(fixture.calls[0].searchParams.get("entity_ids"), "movie:a,artist:b,book:b");
  const queries = fixture.calls.filter((u) => u.pathname === "/v2/insights");
  assert.equal(queries.length, 3);
  assert.equal(queries[0].searchParams.get("signal.interests.entities"), "movie:a,artist:b,book:b");
  assert.equal(queries[0].searchParams.get("take"), "25");
  for (const u of queries.slice(1)) {
    assert.equal(u.searchParams.get("filter.type"), "urn:entity:place");
    assert.equal(u.searchParams.get("filter.results.entities"), "p1,p2");
    assert.equal(u.searchParams.get("take"), "2");
    assert.equal(u.searchParams.get("feature.explainability"), "true");
    assert.equal(u.searchParams.get("sort_by"), "affinity");
  }
  assert.ok(queries.every((u) => u.searchParams.get("filter.location") === "POINT(-73 40)"));
  assert.equal(result.insight.members[0].entities[0].name, "Synthetic movie:a");
  assert.deepEqual(result.insight.rankings[0].entities.map((p) => p.id), ["p1", "p2"]);
  assert.deepEqual(result.insight.rankings[1].entities.map((p) => p.id), ["p2", "p1"]);
  assert.deepEqual(result.insight.rankings[2], { memberId: "c", entities: [], reason: "no_signal" });
  assert.equal(result.insight.rankings[1].entities[1].query.explainability, undefined);
  assert.equal(result.insight.pool[0].memberScores, undefined);
  assert.equal(result.insight.pool[0].openingHours, undefined);
  assert.equal(result.insight.pool[0].price, undefined);
  assert.deepEqual(result.insight.pool[0].external, place("p1").properties.external);
  assert.equal(result.insight.requestStats.network, 4);
});

test("unverified or wrong-kind confirmed IDs block place discovery", async () => {
  for (const details of [[], [entity("movie:a", "book"), ...confirmed.slice(1)]]) {
    const fixture = fixtureFetch({ details });
    const result = await run(compareBody(), fixture);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "entity_unverified");
    assert.equal(fixture.calls.some((u) => u.pathname === "/v2/insights"), false);
    assert.deepEqual(result.insight.pool, []);
  }
});

test("pool deduplicates stable IDs but keeps same-name branches and ignores rejected and unverifiable places", async () => {
  const fixture = fixtureFetch({ pool: [place("p1", { name: "Same cafe" }), place("p1"), place("p2", { name: "Same cafe" }), place("rejected"), place("overseas", { location: { lat: 1, lon: 2 } }), place("unknown", { location: null })], ranks: { "movie:a": [explained("p1", 0.9), explained("p1", 0.8), explained("rejected", 1), explained("outside-pool", 1)] } });
  const result = await run(compareBody({ rejectedIds: ["rejected"] }), fixture);
  assert.equal(result.ok, true);
  assert.deepEqual(result.insight.pool.map((p) => p.id), ["p1", "p2"]);
  assert.deepEqual(result.insight.rankings[0].entities.map((p) => p.id), ["p1"]);
  assert.equal(fixture.calls.find((u) => u.pathname === "/v2/insights").searchParams.get("filter.exclude.entities"), "rejected");
});

test("empty discovered pool has no fabricated alternatives or individual ranking calls", async () => {
  const fixture = fixtureFetch({ pool: [] });
  const result = await run(compareBody(), fixture);
  assert.equal(result.ok, true);
  assert.equal(result.insight.source, "live");
  assert.equal(result.reason, "no_candidates");
  assert.deepEqual(result.insight.pool, []);
  assert.ok(result.insight.rankings.every((r) => r.entities.length === 0));
  assert.equal(fixture.calls.filter((u) => u.pathname === "/v2/insights").length, 1);
});

test("invalid requests and groups without any signal never call Qloo", async () => {
  for (const body of [
    compareBody({ members: [{ id: "a", entities: [] }] }),
    compareBody({ members: [members[0], members[0]] }),
    compareBody({ members: [{ id: "a", entities: [{ id: "x", kind: "food" }] }] }),
    compareBody({ rejectedIds: ["p1&leak=1"] }),
    { mode: "common-search", members: [{ id: "a", preferences: [{ kind: "movie", query: { wrong: true } }] }] },
  ]) {
    const fixture = fixtureFetch();
    const result = await run(body, fixture);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "bad_input");
    assert.equal(fixture.calls.length, 0);
  }
});

test("partial ranking responses retain missing affinity and explanations without adding zero scores", async () => {
  const fixture = fixtureFetch({ ranks: { "movie:a": [{ ...place("p2"), query: {} }] } });
  const result = await run(compareBody(), fixture);
  assert.equal(result.ok, true);
  assert.deepEqual(result.insight.rankings[0].entities.map((p) => p.id), ["p2"]);
  assert.deepEqual(result.insight.rankings[0].entities[0].query, {});
});

test("Qloo search 404 means no matching entities and does not trigger an untyped fallback", async () => {
  let count = 0;
  const result = await run({ mode: "common-search", members: [{ id: "a", preferences: [{ kind: "book", query: "No synthetic match" }] }] }, {
    fetchImpl: async () => { count += 1; return json({}, 404); },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.insight.members[0].preferences[0].matches, []);
  assert.equal(count, 1);
});

test("Qloo entity 404 blocks confirmation and pool 404 returns an honest empty pool", async () => {
  const missing = await run(compareBody(), { fetchImpl: async () => json({}, 404) });
  assert.equal(missing.reason, "entity_unverified");
  const empty = await run(compareBody(), { fetchImpl: async (url) => new URL(url).pathname === "/entities" ? json({ results: confirmed }) : json({}, 404) });
  assert.equal(empty.ok, true);
  assert.equal(empty.reason, "no_candidates");
  assert.deepEqual(empty.insight.pool, []);
});

test("common retries are audited and a failed new comparison cannot return a prior live result", async () => {
  const fixture = fixtureFetch();
  const cache = new Map();
  let remainingFailures = 1;
  const first = await run(compareBody(), { fetchImpl: async (url) => remainingFailures-- > 0 ? json({}, 429) : fixture.fetchImpl(url) }, { cache, rateLimitBackoffMs: [0] });
  assert.equal(first.ok, true);
  assert.equal(first.insight.requestStats.retries, 1);
  assert.equal(first.insight.requestStats.rateLimited, 1);
  const second = await run(compareBody(), { fetchImpl: async () => json({}, 503) }, { cache });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "down");
  assert.equal(second.insight.source, "unavailable");
  assert.deepEqual(second.insight.pool, []);
  assert.equal(second.insight.requestStats.failed, 1);
});

test("common mode reuses strict destination resolution and exposes ambiguous city facts", async () => {
  const fixture = fixtureFetch({ search: [
    entity("city:one", "locality", { name: "Synthetic City", location: { lat: 40, lon: -73 }, tags: [{ tag_id: "urn:tag:genre:locality:city" }] }),
    entity("city:two", "locality", { name: "Synthetic City", location: { lat: 1, lon: 2 }, tags: [{ tag_id: "urn:tag:genre:locality:city" }] }),
  ] });
  const result = await run(compareBody({ context: { city: "Synthetic City" } }), fixture);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "destination_unresolved");
  assert.equal(result.insight.destinationCandidates.length, 2);
  assert.equal(fixture.calls.some((u) => u.pathname === "/v2/insights"), false);
});

test("common comparisons preserve upstream pool and ranking warnings without invented explanation text", async () => {
  const fixture = fixtureFetch();
  const result = await run(compareBody(), { fetchImpl: async (url) => {
    const response = await fixture.fetchImpl(url);
    const body = await response.json();
    const u = new URL(url);
    if (u.pathname === "/v2/insights") {
      body.warnings = u.searchParams.has("filter.results.entities") ? ["Synthetic ranking warning"] : ["Synthetic pool warning"];
      body.query = { explainability: { warning: "Synthetic partial contribution warning" } };
    }
    return json(body);
  } });
  assert.deepEqual(result.insight.poolWarnings, ["Synthetic pool warning"]);
  assert.deepEqual(result.insight.rankings[0].warnings, ["Synthetic ranking warning"]);
  assert.equal(result.insight.rankings[0].queryWarning, "Synthetic partial contribution warning");
  assert.equal(result.insight.rankings[2].warnings, undefined);
});

test("known entity subtype is evidence when the API returns no root type or types", async () => {
  const fixture = fixtureFetch({ pool: [{ ...place("p1"), types: undefined, subtype: "urn:entity:place" }], details: confirmed.map((item) => ({ ...item, subtype: item.types[0], types: undefined })) });
  const result = await run(compareBody(), fixture);
  assert.equal(result.ok, true);
  assert.deepEqual(result.insight.pool.map((p) => p.id), ["p1"]);
});
