import assert from "node:assert/strict";
import test from "node:test";
import { handleQlooRequest } from "../server/handleQloo.js";
import { createBrowserQlooClient } from "../src/qloo/browserClient.js";
import { parseTastes } from "../src/pipeline/parse.js";
import { planRoute } from "../src/pipeline/routePlanner.js";
import { runPipeline } from "../src/pipeline/run.js";

const centers = { "New York": [40.7484, -73.9857, "US"], Tokyo: [35.6762, 139.6503, "JP"], Paris: [48.8566, 2.3522, "FR"] };
const json = (body) => ({ ok: true, status: 200, json: async () => structuredClone(body) });
function locality(name, lat, lng, country_code) {
  return { entity_id: `locality:${name}:${country_code}`, name, type: "urn:entity:locality", location: { lat, lon: lng }, tags: [{ tag_id: "urn:tag:genre:locality:city" }], properties: { geocode: { country_code } } };
}
function venue(id, lat, lng, geocode = {}) {
  return { entity_id: id, name: `${id} Restaurant`, type: "urn:entity:place", location: { lat, lon: lng }, properties: { geocode }, tags: [{ name: "Restaurant" }], query: { affinity: 0.8 } };
}
async function run(city, { places, localities, coordinates, ownCity } = {}) {
  const center = centers[city] || centers.Paris;
  const calls = [];
  const raw = { context: { city, time: "18:00-22:00", ...(coordinates ? { coordinates } : {}) }, members: [1, 2, 3].map((i) => ({ id: `m${i}`, preferences: ["movie", "artist", "food"], city: ownCity || city })) };
  const inputPlaces = places || [venue("local", ...center.slice(0, 2), { city, country_code: center[2] }), venue("overseas", 42.9278021, 11.3584034)];
  const before = JSON.stringify(inputPlaces);
  const fetchImpl = async (url) => {
    const u = new URL(url); calls.push(u);
    if (u.searchParams.get("types") === "urn:entity:locality") return json({ results: localities ?? [locality(city, ...center)] });
    if (u.pathname === "/search") return json({ results: [{ entity_id: "taste", name: "taste", type: "urn:entity:movie" }] });
    if (u.pathname === "/v2/tags") {
      const music = u.searchParams.get("filter.query") !== "restaurant";
      return json({ results: { tags: [{ id: `urn:tag:category:place:${music ? "jazz_club" : "restaurant"}`, name: music ? "Jazz Club" : "Restaurant" }] } });
    }
    return json({ results: { entities: inputPlaces } });
  };
  const client = createBrowserQlooClient({ fetchImpl: async (_url, init) => json(await handleQlooRequest(JSON.parse(init.body), { env: { QLOO_API_KEY: "fixture" }, fetchImpl, cache: new Map() })) });
  const parsed = parseTastes(raw);
  const insight = await client.resolveMembers(parsed);
  const route = planRoute({ members: parsed.members, context: parsed.context, candidates: insight.suggestions });
  assert.equal(JSON.stringify(inputPlaces), before, "must not rewrite upstream facts");
  return { insight, route, calls };
}

for (const city of Object.keys(centers)) test(`${city}: text destination constrains the real browser/server/route path`, async () => {
  const { insight, route, calls } = await run(city);
  assert.deepEqual(insight.suggestions.map((s) => s.id), ["local"]);
  assert.deepEqual(route.stops.map((s) => s.id), ["local"]);
  assert.equal(insight.suggestions[0].city, city);
  assert.equal(insight.suggestions[0].country, centers[city][2]);
  assert.equal(route.stops[0].city, city);
  assert.equal(route.stops[0].country, centers[city][2]);
  assert.equal(route.stops[0].lat, centers[city][0]);
  assert.ok(calls.filter((u) => u.pathname === "/v2/insights").every((u) => u.searchParams.has("filter.location")));
  assert.ok(calls.filter((u) => u.pathname === "/v2/insights").every((u) => u.searchParams.get("filter.location.radius") === "0"));
});

test("common destination cannot be replaced by a member's foreign city", async () => {
  const { route, calls } = await run("Paris", { ownCity: "Tokyo" });
  assert.deepEqual(route.stops.map((s) => s.id), ["local"]);
  assert.ok(calls.filter((u) => u.pathname === "/v2/insights").every((u) => u.searchParams.get("filter.location") === "locality:Paris:FR"));
});

for (const [label, localities] of [
  ["unknown", []],
  ["fuzzy wrong city", [locality("Parisville", 48.85, 2.35, "FR")]],
  ["ambiguous same name", [locality("Paris", 48.85, 2.35, "FR"), locality("Paris", 33.66, -95.55, "US")]],
  ["missing locality coordinates", [{ entity_id: "paris", name: "Paris", type: "urn:entity:locality" }]],
]) test(`${label}: no global search or invented route`, async () => {
  const { insight, route, calls } = await run("Paris", { localities });
  assert.equal(route.stops.length, 0);
  assert.match(insight.reason, /^destination_/);
  assert.match(insight.warning, /目的地|地理|坐标/);
  assert.equal(calls.some((u) => u.pathname === "/v2/insights"), false);
});

test("missing/invalid candidate coordinates and overseas coordinates never pass by city label", async () => {
  const { insight, route } = await run("Paris", { places: [
    venue("wrong", 42.9278021, 11.3584034, { city: "Paris", country_code: "FR" }),
    venue("unknown", undefined, undefined, { city: "Paris", country_code: "FR" }),
    venue("invalid", 999, 2.35, { city: "Paris" }),
  ] });
  assert.equal(route.stops.length, 0);
  assert.equal(insight.reason, "no_verified_places");
});

test("coordinates can verify proximity without fabricating a missing source city", async () => {
  const { insight, route } = await run("Paris", { places: [venue("near", 48.8566, 2.3522, { country_code: "FR" })] });
  assert.equal(route.stops.length, 1);
  assert.equal(insight.suggestions[0].city, "");
  assert.equal(insight.suggestions[0].country, "FR");
});

test("invalid supplied coordinates fail explicitly instead of falling back to global lookup", async () => {
  const { insight, route } = await run("Paris", { coordinates: { lat: 91, lng: 2 } });
  assert.equal(route.stops.length, 0);
  assert.match(insight.reason, /destination_|bad_input/);
});

test("legacy pair destination failure cannot turn into a mock itinerary", async () => {
  const client = createBrowserQlooClient({ fetchImpl: async (_url, init) => json(await handleQlooRequest(JSON.parse(init.body), {
    env: { QLOO_API_KEY: "fixture" }, cache: new Map(), fetchImpl: async () => json({ results: [] }),
  })) });
  const result = await runPipeline({ a: ["a", "b", "c"], b: ["d", "e", "f"], context: { city: "Unknown" } }, client);
  assert.equal(result.route.stops.length, 0);
  assert.equal(result.insight.reason, "destination_unresolved");
});

test("country-qualified same-name destination selects only the matching country", async () => {
  const { insight, route } = await run("Paris, FR", { localities: [locality("Paris", 48.8566, 2.3522, "FR"), locality("Paris", 33.66, -95.55, "US")], places: [venue("french", 48.8566, 2.3522, { city: "Paris", country_code: "FR" }), venue("wrong-country", 48.8566, 2.3522, { city: "Paris", country_code: "US" })] });
  assert.deepEqual(route.stops.map((s) => s.id), ["french"]);
  assert.equal(insight.destination.country, "FR");
});

test("a full search page with one exact locality and unrelated fuzzy hits can resolve", async () => {
  const localities = [locality("Tokyo",35.6762,139.6503,"JP"), ...Array.from({length:19},(_,i)=>locality(`Other ${i}`,0,0,"US"))];
  const { insight, route } = await run("Tokyo", { localities });
  assert.equal(insight.destination?.city, "Tokyo");
  assert.equal(route.stops.length, 1);
});

test("ambiguous destination exposes source facts for disambiguation without inventing a selection", async () => {
  const { insight } = await run("Paris", { localities:[locality("Paris",48.85,2.35,"FR"),locality("Paris",33.66,-95.55,"US")] });
  assert.equal(insight.destinationCandidates?.length,2);
  assert.equal(insight.destinationCandidates[0].country,"FR");
  assert.equal(insight.suggestions.length,0);
});

test("coordinate fields are read as a pair, never mixed across unrelated nested fields", async () => {
  const place = venue("actual-overseas", 42.9278021, 11.3584034, { latitude: 48.8566, longitude: 2.3522 });
  const { insight } = await run("Paris", { places: [place] });
  assert.equal(insight.suggestions.length, 0);
});

test("null input coordinates are not converted into an apparently valid zero point", async () => {
  await assert.rejects(run("Paris", { coordinates: { lat: null, lng: null } }), /坐标/);
});

test("destination lookup failure cannot silently become an unrelated fallback route", async () => {
  const client = createBrowserQlooClient({ fetchImpl: async (_url, init) => json(await handleQlooRequest(JSON.parse(init.body), {
    env: { QLOO_API_KEY: "fixture" }, cache: new Map(), fetchImpl: async () => ({ ok: false, status: 400 }),
  })) });
  const result = await runPipeline({ a: ["a", "b", "c"], b: ["d", "e", "f"], context: { city: "Unknown" } }, client);
  assert.equal(result.route.stops.length, 0);
  assert.equal(result.insight.source, "unavailable");
});

// Shapes and coordinates observed in the real Preview responses on 2026-10-15.
function typedLocality(id, name, lat, lng, kind, aliases = []) {
  return { entity_id: id, name, types: ["urn:entity:locality"], location: { lat, lon: lng },
    tags: kind ? [{ tag_id: `urn:tag:genre:locality:${kind}` }] : [], properties: { akas: aliases.map(value => ({ value })) } };
}

test("New York city is distinguished from the same-name state and neighbourhood independent of order", async () => {
  const city = typedLocality("ny-city", "New York", 40.66320611815103, -73.93889084762313, "city");
  const state = typedLocality("ny-state", "New York", 42.92258073352795, -75.5978240134976, "state");
  const neighbourhood = typedLocality("ny-neighbourhood", "New York", 53, -1, "neighbourhood");
  for (const localities of [[state, city, neighbourhood], [neighbourhood, state, city]]) {
    const { insight, route, calls } = await run("New York", { localities });
    assert.equal(insight.destination?.id, "ny-city");
    assert.equal(route.stops.length, 1);
    assert.ok(calls.filter(u => u.pathname === "/v2/insights").every(u => u.searchParams.get("filter.location") === "ny-city"));
  }
});

test("Tokyo province or Dubai islet alone cannot masquerade as a city even with exact aliases", async () => {
  for (const item of [
    typedLocality("tokyo-province", "東京都", 29.98951588377753, 140.76766474343927, "province", ["Tokyo"]),
    typedLocality("tokyo-islet", "Tokyo", 25.248616750083087, 55.181404851709054, "islet"),
  ]) {
    const { insight, calls } = await run("Tokyo", { localities: [item], places: [venue("near-wrong-locality", item.location.lat, item.location.lon)] });
    assert.match(insight.reason, /^destination_/);
    assert.equal(insight.suggestions.length, 0);
    assert.equal(calls.some(u => u.pathname === "/v2/insights"), false);
  }
});

test("missing locality kind is unverified, and cannot be discarded to select a foreign same-name city", async () => {
  const untypedParis = typedLocality("paris-fr", "Paris", 48.86, 2.34, null);
  const usParis = typedLocality("paris-us", "Paris", 36.30, -88.31, "city");
  for (const localities of [[untypedParis], [untypedParis, usParis]]) {
    const { insight, calls } = await run("Paris", { localities });
    assert.match(insight.reason, /^destination_/);
    assert.equal(calls.some(u => u.pathname === "/v2/insights"), false);
  }
});

