import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_INPUT, THREE_MEMBER_INPUT } from "../src/data.js";
import { handleQlooRequest, resolveApiKey, resolveMembersHarness } from "../server/handleQloo.js";
import { createBrowserQlooClient } from "../src/qloo/browserClient.js";
import { parseTastes } from "../src/pipeline/parse.js";

const SECRET = "test-key-should-not-leak";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("N=3 input reaches the API parser without entering the A/B Qloo route", async () => {
  const result = await handleQlooRequest(THREE_MEMBER_INPUT, {
    env: { QLOO_API_KEY: SECRET },
    fetchImpl: async () => {
      throw new Error("N=3 must not call Qloo in this phase");
    },
  });
  assert.equal(result.reason, "group_not_supported");
  assert.match(result.warning, /成员契约/);
});

const VENUE_TAGS = {
  restaurant: { id: "urn:tag:category:place:restaurant", name: "Restaurant" },
  bar: { id: "urn:tag:category:place:bar", name: "Bar" },
  "live music": { id: "urn:tag:category:place:live_music_venue", name: "Live Music Venue" },
  "jazz club": { id: "urn:tag:category:place:jazz_club", name: "Jazz Club" },
  "night club": { id: "urn:tag:category:place:night_club", name: "Night Club" },
};

function tagResponse(url) {
  const href = String(url);
  if (!href.includes("/v2/tags")) return null;
  const query = new URL(href).searchParams.get("filter.query");
  const tag = VENUE_TAGS[query];
  return jsonResponse({ results: { tags: tag ? [tag] : [] } });
}

function localityBody(entities) {
  return {
    query: { locality: { signal: { name: "New York City", entity_id: "loc:nyc" } } },
    results: { entities },
  };
}

const HEX_KEY = "ab".repeat(40);

test("a plain server key is sent unchanged, including a long hex string", async () => {
  let sent = "";
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: `  ${HEX_KEY}  ` },
    cache: new Map(),
    fetchImpl(url, init) {
      sent = init.headers["X-Api-Key"];
      const tags = tagResponse(url);
      if (tags) return tags;
      return jsonResponse({ error: "slow down" }, 429);
    },
  });
  assert.equal(HEX_KEY.length >= 64 && HEX_KEY.length % 2 === 0, true);
  assert.equal(resolveApiKey(`  ${HEX_KEY}  `), HEX_KEY);
  assert.equal(sent, HEX_KEY);
  assert.equal(resolveApiKey(SECRET), SECRET);
  assert.equal(resolveApiKey(""), "");
  assert.equal(resolveApiKey("  abcd  "), "abcd");
  const body = JSON.stringify(result);
  assert.equal(body.includes(HEX_KEY), false);
  assert.equal(body.includes(SECRET), false);
  assert.equal(result.reason, "rate_limit");
});

test("missing server key does not call Qloo and returns the rules baseline", async () => {
  let called = false;
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: {},
    cache: new Map(),
    fetchImpl() {
      called = true;
      throw new Error("should not fetch");
    },
  });
  const body = JSON.stringify(result);
  assert.equal(called, false);
  assert.equal(result.reason, "missing_key");
  assert.equal(result.insight.source, "fallback");
  assert.equal(result.insight.fromQloo, false);
  assert.equal(result.insight.entities.a[0].id.startsWith("mock:"), true);
  assert.equal(body.includes("qloo:replay"), false);
  assert.equal(body.includes("qloo:entity"), false);
  assert.equal(body.includes(SECRET), false);
});

test("rate limit falls back with a route the page can render", async () => {
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET, QLOO_TIMEOUT_MS: "1000" },
    cache: new Map(),
    fetchImpl: async () => jsonResponse({ error: "slow down" }, 429),
  });
  assert.equal(result.reason, "rate_limit");
  assert.match(result.warning, /这次是备用数据/);
  assert.equal(result.insight.source, "fallback");
  assert.equal(result.insight.fromQloo, false);
  assert.equal(result.insight.entities.a[0].id.startsWith("mock:"), true);
  assert.equal(JSON.stringify(result).includes("qloo:replay"), false);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("timeout falls back and the next identical call is not cached", async () => {
  let fetches = 0;
  const fetchImpl = (_url, { signal }) => {
    fetches += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  };
  const cache = new Map();
  const env = { QLOO_API_KEY: SECRET, QLOO_TIMEOUT_MS: "20" };
  const first = await handleQlooRequest(DEMO_INPUT, { env, cache, fetchImpl });
  const callsAfterFirst = fetches;
  const second = await handleQlooRequest(DEMO_INPUT, { env, cache, fetchImpl });
  assert.equal(first.reason, "timeout");
  assert.equal(first.insight.source, "fallback");
  assert.equal(first.insight.fromQloo, false);
  assert.equal(second.reason, "timeout");
  assert.equal(second.insight.cached, false);
  assert.ok(fetches > callsAfterFirst);
  assert.equal(JSON.stringify(first).includes(SECRET), false);
});

test("a live response does not invent affinity scores", async () => {
  const fetchImpl = async (url) => {
    const tags = tagResponse(url);
    if (tags) return tags;
    const href = String(url);
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({ results: [{ id: `ent:${query}`, name: query }] });
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse(localityBody([{ id: "place:1", name: "Night counter", tags: [{ name: "Restaurant" }], properties: { geocode: { name: "New York" } } }]));
    }
    throw new Error(`unexpected ${href}`);
  };
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET },
    cache: new Map(),
    fetchImpl,
  });
  const body = JSON.stringify(result);
  assert.equal(result.ok, true);
  assert.equal(result.insight.source, "live");
  assert.equal(result.insight.fromQloo, true);
  assert.equal(result.insight.suggestions[0].name, "Night counter");
  assert.equal(result.insight.entities.a[0].affinity, undefined);
  assert.equal(result.insight.tensions[0].a.title, "Whiplash");
  assert.equal(body.includes("粉彩对称"), false);
  assert.equal(body.includes("mock:fixture"), false);
  assert.equal(body.includes("qloo:replay"), false);
  assert.match(body, /qloo:entity/);
  assert.equal(/\baffinity\b/.test(body), false);
  assert.equal(body.includes(SECRET), false);
  assert.equal("score" in result.insight, false);
});

test("a live affinity is copied from the payload and not relabeled as replay", async () => {
  const fetchImpl = async (url) => {
    const tags = tagResponse(url);
    if (tags) return tags;
    const href = String(url);
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({ results: [{ entity_id: `ent:${query}`, name: query, query: { affinity: 0.42 } }] });
    }
    if (href.includes("filter.results.entities")) {
      return jsonResponse({
        results: { entities: [{ entity_id: "place:1", name: "Night counter", query: { affinity: 0.77 } }] },
      });
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse(localityBody([{ entity_id: "place:1", name: "Night counter", tags: [{ name: "Bar" }], properties: { geocode: { name: "New York" } }, query: { affinity: 0.77 } }]));
    }
    throw new Error(`unexpected ${href}`);
  };
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET },
    cache: new Map(),
    fetchImpl,
  });
  const body = JSON.stringify(result);
  assert.equal(result.insight.entities.a[0].affinity, 0.42);
  assert.equal(result.insight.suggestions[0].affinity, 0.77);
  assert.match(result.insight.tensions[0].a.detail, /0\.42/);
  assert.equal(body.includes("mock:fixture"), false);
  assert.equal(body.includes("qloo:replay"), false);
  assert.equal(body.includes(SECRET), false);
});

test("an unreachable Qloo host falls back instead of throwing", async () => {
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET },
    cache: new Map(),
    fetchImpl() {
      throw new Error("network down");
    },
  });
  assert.equal(result.reason, "down");
  assert.equal(result.insight.source, "fallback");
  assert.equal(result.insight.entities.a[0].id.startsWith("mock:"), true);
});

test("browser client treats a dead proxy as offline and still returns entities", async () => {
  let fetches = 0;
  const client = createBrowserQlooClient({
    cache: new Map(),
    fetchImpl() {
      fetches += 1;
      throw new Error("failed to fetch");
    },
  });
  const parsed = parseTastes(DEMO_INPUT);
  const first = await client.resolvePair(parsed);
  const second = await client.resolvePair(parsed);
  assert.equal(first.source, "fallback");
  assert.equal(first.reason, "offline");
  assert.equal(first.fromQloo, false);
  assert.equal(first.entities.a[0].id.startsWith("mock:"), true);
  assert.equal(JSON.stringify(first).includes("qloo:replay"), false);
  assert.equal(second.cached, true);
  assert.equal(fetches, 1);
});

test("browser preview modes do not hit the network", async () => {
  let fetches = 0;
  const client = createBrowserQlooClient({
    preview: () => "rate_limit",
    fetchImpl() {
      fetches += 1;
      throw new Error("should not fetch");
    },
  });
  const result = await client.resolvePair(parseTastes(DEMO_INPUT));
  assert.equal(fetches, 0);
  assert.equal(result.reason, "rate_limit");
  assert.equal(result.source, "fallback");
  assert.match(result.warning, /预览/);
});

test("live calls are GET on the hackathon host and insights use query params", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, headers: init?.headers, body: init?.body });
    const tags = tagResponse(url);
    if (tags) return tags;
    const href = String(url);
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({
        results: [{ entity_id: `ent:${query}`, name: query, type: "urn:entity:movie" }],
      });
    }
    if (href.includes("filter.results.entities")) {
      const id = new URL(href).searchParams.get("filter.results.entities").split(",")[0];
      return jsonResponse({
        results: { entities: [{ entity_id: id, name: "cross", query: { affinity: 0.18 } }] },
      });
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse(localityBody([
        { entity_id: "urn:entity:place:night-counter", name: "Night counter", type: "urn:entity:place", tags: [{ name: "Restaurant" }], properties: { geocode: { name: "New York" } }, query: { affinity: 0.77 } },
      ]));
    }
    throw new Error(`unexpected ${href}`);
  };
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET, QLOO_BASE_URL: "https://staging.api.qloo.com" },
    cache: new Map(),
    fetchImpl,
  });
  assert.equal(result.insight.source, "live");
  assert.equal(result.insight.entities.a[0].affinity, 0.18);
  assert.equal(result.insight.suggestions[0].name, "Night counter");
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.method, "GET");
    assert.equal(call.body, undefined);
    assert.ok(call.url.startsWith("https://hackathon.api.qloo.com"));
    assert.equal(call.headers["X-Api-Key"], SECRET);
    assert.equal(call.headers.Authorization, undefined);
    assert.equal(call.headers.authorization, undefined);
  }
  const joined = calls.map((call) => call.url).join("\n");
  assert.equal(joined.includes("/recs"), false);
  assert.equal(joined.includes("food_and_drink"), false);
  assert.equal(joined.includes("staging.api.qloo.com"), false);
  const discoveries = calls
    .map((call) => decodeURIComponent(call.url).replaceAll("+", " "))
    .filter((url) => url.includes("filter.tags=") && url.includes("/v2/insights"));
  assert.equal(discoveries.length, 2);
  const musicUrl = discoveries.find((url) => url.includes("urn:tag:category:place:jazz_club"));
  const foodUrl = discoveries.find((url) => url.includes("urn:tag:category:place:restaurant"));
  assert.ok(musicUrl);
  assert.ok(foodUrl);
  assert.equal(musicUrl.includes("urn:tag:category:place:restaurant"), false);
  assert.equal(foodUrl.includes("jazz_club"), false);
  assert.equal(musicUrl.includes("Kamasi"), true);
  assert.equal(musicUrl.includes("Whiplash"), false);
  assert.equal(foodUrl.includes("Blue Note"), true);
  assert.equal(musicUrl.includes("take=8"), true);
  assert.equal(foodUrl.includes("take=8"), true);
  assert.equal(musicUrl.includes("filter.location=POINT(-73.9857 40.7484)"), true);
  assert.equal(foodUrl.includes("filter.location.radius=12000"), true);
  assert.equal(foodUrl.includes("filter.tags=restaurant"), false);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal(JSON.stringify(result).includes("qloo:replay"), false);
  assert.equal(JSON.stringify(result).includes("mock:fixture"), false);
});

test("search and insights stay serial, and a 429 succeeds on the third try", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let firstUrl = "";
  const counts = new Map();
  const fetchImpl = async (url) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const href = String(url);
      if (!firstUrl) firstUrl = href;
      const count = (counts.get(href) || 0) + 1;
      counts.set(href, count);
      if (href === firstUrl && count < 3) return jsonResponse({ error: "slow down" }, 429);
      const tags = tagResponse(url);
      if (tags) return tags;
      if (href.includes("/search")) {
        const query = new URL(href).searchParams.get("query");
        return jsonResponse({
          results: [{ entity_id: `ent:${query}`, name: query, type: "urn:entity:movie" }],
        });
      }
      if (href.includes("/v2/insights")) {
        return jsonResponse(localityBody([
          { entity_id: "place:jazz", name: "Smalls Jazz Club", tags: [{ name: "Jazz Club" }], properties: { geocode: { name: "New York" } }, query: { affinity: 0.4 } },
        ]));
      }
      throw new Error(`unexpected ${href}`);
    } finally {
      inFlight -= 1;
    }
  };
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET },
    cache: new Map(),
    fetchImpl,
  });
  assert.equal(maxInFlight, 1);
  assert.equal(counts.get(firstUrl), 3);
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
  assert.equal(result.insight.source, "live");
  assert.match(JSON.stringify(result), /qloo:entity/);
  assert.equal(JSON.stringify(result).includes("mock:fixture"), false);
});

test("rate limit and down responses are not cached, a live success is", async () => {
  const env = { QLOO_API_KEY: SECRET };
  let limited = 0;
  const limitCache = new Map();
  const limitFetch = async () => {
    limited += 1;
    return jsonResponse({ error: "slow down" }, 429);
  };
  const firstLimit = await handleQlooRequest(DEMO_INPUT, { env, cache: limitCache, fetchImpl: limitFetch });
  const afterLimit = limited;
  const secondLimit = await handleQlooRequest(DEMO_INPUT, { env, cache: limitCache, fetchImpl: limitFetch });
  assert.equal(firstLimit.reason, "rate_limit");
  assert.equal(secondLimit.reason, "rate_limit");
  assert.equal(secondLimit.insight.cached, false);
  assert.ok(limited > afterLimit);

  let downCalls = 0;
  const downCache = new Map();
  const downFetch = () => {
    downCalls += 1;
    throw new Error("network down");
  };
  const firstDown = await handleQlooRequest(DEMO_INPUT, { env, cache: downCache, fetchImpl: downFetch });
  const secondDown = await handleQlooRequest(DEMO_INPUT, { env, cache: downCache, fetchImpl: downFetch });
  assert.equal(firstDown.reason, "down");
  assert.equal(secondDown.reason, "down");
  assert.equal(secondDown.insight.cached, false);
  assert.ok(downCalls > 2);

  let liveCalls = 0;
  const liveCache = new Map();
  const liveFetch = async (url) => {
    liveCalls += 1;
    const tags = tagResponse(url);
    if (tags) return tags;
    const href = String(url);
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({ results: [{ id: `ent:${query}`, name: query }] });
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse(localityBody([{ id: "place:1", name: "Night counter", tags: [{ name: "Restaurant" }], properties: { geocode: { name: "New York" } } }]));
    }
    throw new Error(`unexpected ${href}`);
  };
  const firstLive = await handleQlooRequest(DEMO_INPUT, { env, cache: liveCache, fetchImpl: liveFetch });
  const afterLive = liveCalls;
  const secondLive = await handleQlooRequest(DEMO_INPUT, { env, cache: liveCache, fetchImpl: liveFetch });
  assert.equal(firstLive.ok, true);
  assert.equal(firstLive.reason, null);
  assert.equal(secondLive.insight.cached, true);
  assert.equal(secondLive.insight.cacheLabel, "Qloo 实时结果（已缓存）");
  assert.equal(liveCalls, afterLive);
});

test("place insights stay in one city and drop hotels", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    const tags = tagResponse(url);
    if (tags) return tags;
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      const type = href.includes("urn:entity:artist") ? "urn:entity:artist" : "urn:entity:movie";
      return jsonResponse({ results: [{ entity_id: `ent:${query}`, name: query, type }] });
    }
    if (href.includes("filter.results.entities") && href.includes("filter.location=")) {
      const signal = new URL(href).searchParams.get("signal.interests.entities") || "";
      const affinity = signal.includes("Kamasi") || signal.includes("Whiplash") ? 0.22 : 0.71;
      return jsonResponse({
        results: { entities: [{ entity_id: "place:vanguard", query: { affinity } }] },
      });
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse(localityBody([
        { entity_id: "place:hotel", name: "W New York - Times Square", tags: [{ name: "Hotel" }], properties: { geocode: { name: "New York" } }, query: { affinity: 0.95 } },
        { entity_id: "place:apt", name: "leQube Apartments", tags: [{ name: "Apartment" }], properties: { geocode: { name: "New York" } }, query: { affinity: 0.93 } },
        { entity_id: "place:vanguard", name: "Village Vanguard", tags: [{ name: "Jazz Club" }], properties: { geocode: { name: "New York" } }, query: { affinity: 0.4 } },
        { entity_id: "place:smalls", name: "Smalls", tags: [{ name: "Jazz Club" }], properties: { geocode: { name: "Greenwich Village" } }, location: { lat: 40.7304, lon: -74.001 }, query: { affinity: 0.5 } },
        { entity_id: "place:shibuya", name: "Shibuya Jazz Bar", tags: [{ name: "Jazz Club" }], properties: { geocode: { name: "Shibuya", latitude: 35.66, longitude: 139.7 } }, query: { affinity: 0.88 } },
        { entity_id: "place:tokyo", name: "ONE@Tokyo", tags: [{ name: "Hotel" }], properties: { geocode: { name: "Tokyo" } }, query: { affinity: 0.9 } },
      ]));
    }
    throw new Error(`unexpected ${href}`);
  };
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET },
    cache: new Map(),
    fetchImpl,
  });
  const discoveries = calls
    .filter((href) => href.includes("/v2/insights") && href.includes("filter.tags="))
    .map((href) => decodeURIComponent(href).replaceAll("+", " "));
  assert.equal(discoveries.length, 2);
  assert.equal(discoveries.every((href) => href.includes("filter.location=POINT(-73.9857 40.7484)")), true);
  assert.equal(discoveries.every((href) => href.includes("filter.location.radius=12000")), true);
  assert.equal(discoveries.some((href) => href.includes("urn:tag:category:place:jazz_club")), true);
  assert.equal(discoveries.some((href) => href.includes("/v2/tags")), false);
  const names = result.insight.suggestions.map((item) => item.name);
  assert.deepEqual(names, ["Village Vanguard", "Smalls"]);
  assert.equal(result.insight.locality.name, "New York City");
  assert.deepEqual(result.insight.locationFilter.outsideCities, ["Shibuya", "Tokyo"]);
  assert.equal(result.insight.suggestions[0].affinityA, 0.22);
  assert.equal(result.insight.suggestions[0].affinityB, 0.71);
  assert.equal(result.insight.suggestions[0].city, "New York");
  const body = JSON.stringify(result);
  assert.equal(body.includes("W New York"), false);
  assert.equal(body.includes("leQube"), false);
  assert.equal(body.includes("ONE@Tokyo"), false);
  assert.equal(body.includes("mock:fixture"), false);
});

test("place coverage reports address, coordinates, and hours fields", async () => {
  const fetchImpl = async (url) => {
    const tags = tagResponse(url);
    if (tags) return tags;
    const href = String(url);
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({ results: [{ entity_id: `ent:${query}`, name: query, type: "urn:entity:movie" }] });
    }
    if (href.includes("filter.results.entities") && href.includes("filter.location=")) {
      return jsonResponse({
        results: {
          entities: [
            { entity_id: "place:club", query: { affinity: 0.61 } },
            { entity_id: "place:door", query: { affinity: 0.2 } },
          ],
        },
      });
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse(localityBody([
        {
          entity_id: "place:club",
          name: "Club",
          tags: [{ name: "Jazz Club" }],
          properties: {
            address: "178 7th Ave S",
            geocode: { name: "New York", latitude: 40.73, longitude: -74 },
          },
          query: { affinity: 0.4 },
        },
        {
          entity_id: "place:door",
          name: "Next Door",
          tags: [{ name: "Bar" }],
          properties: {
            geocode: { name: "New York", latitude: 40.731, longitude: -74.001 },
            hours: { monday: "18:00-02:00" },
          },
          query: { affinity: 0.3 },
        },
      ]));
    }
    throw new Error(`unexpected ${href}`);
  };
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET },
    cache: new Map(),
    fetchImpl,
  });
  assert.deepEqual(result.insight.placeCoverage, {
    places: 2,
    withAddress: 1,
    withCoords: 2,
    withHours: 1,
    addressFields: ["properties.address"],
    coordFields: ["properties.geocode.latitude", "properties.geocode.longitude"],
    hourFields: ["properties.hours"],
  });
  assert.equal(result.insight.suggestions[0].lat, 40.73);
  assert.equal(result.insight.suggestions[1].name, "Next Door");
});

test("music and food insights merge into a mixed route", async () => {
  const nyc = { name: "New York" };
  const place = (id, name, tag, lat) => ({
    entity_id: id,
    name,
    tags: [{ name: tag, id: tag === "Jazz Club" ? "urn:tag:category:place:jazz_club" : "urn:tag:category:place:restaurant" }],
    properties: { geocode: { ...nyc, latitude: lat, longitude: -74 } },
  });
  const fetchImpl = async (url) => {
    const tags = tagResponse(url);
    if (tags) return tags;
    const href = decodeURIComponent(String(url));
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({ results: [{ entity_id: `ent:${query}`, name: query, type: "urn:entity:movie" }] });
    }
    if (href.includes("filter.results.entities") && href.includes("filter.location=")) {
      const ids = new URL(href).searchParams.get("filter.results.entities").split(",");
      return jsonResponse({
        results: { entities: ids.map((id, index) => ({ entity_id: id, query: { affinity: 0.4 + index * 0.1 } })) },
      });
    }
    if (href.includes("jazz_club")) {
      return jsonResponse(localityBody([
        place("place:vanguard", "Village Vanguard", "Jazz Club", 40.736),
        place("place:blue", "Blue Note", "Jazz Club", 40.73),
        place("place:pizza", "Joe's Pizza", "Restaurant", 40.73),
      ]));
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse(localityBody([
        place("place:ramen", "Late Ramen", "Restaurant", 40.72),
        place("place:habana", "Cafe Habana", "Restaurant", 40.722),
        { entity_id: "place:hotel", name: "W New York - Times Square", tags: [{ name: "Hotel" }], properties: { geocode: nyc } },
      ]));
    }
    throw new Error(`unexpected ${href}`);
  };
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET },
    cache: new Map(),
    fetchImpl,
  });
  const names = result.insight.suggestions.map((item) => item.name);
  assert.equal(names.length >= 3 && names.length <= 4, true);
  assert.equal(names.includes("Village Vanguard") || names.includes("Blue Note"), true);
  assert.equal(names.includes("Late Ramen"), true);
  assert.equal(names.includes("W New York - Times Square"), false);
  assert.equal(result.insight.locationFilter.musicKept >= 1, true);
  assert.equal(result.insight.locationFilter.foodKept >= 1, true);
});

 test("multi-member Qloo harness keeps member entities and auditable request stats", async () => {
  const input = {
    mode: "members-harness",
    context: { city: "上海", start: "人民广场", coordinates: { lat: 31.2304, lng: 121.4737, radiusM: 9000 } },
    members: [
      { id: "m1", name: "甲", preferences: ["电影", "爵士", "火锅"] },
      { id: "m2", name: "乙", preferences: ["展览", "摇滚", "烧烤"] },
      { id: "m3", name: "丙", preferences: ["喜剧", "民谣", "面食"] },
    ],
  };
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes("/v2/tags")) {
      const query = new URL(href).searchParams.get("filter.query");
      const tag = query === "restaurant" ? VENUE_TAGS.restaurant : VENUE_TAGS["jazz club"];
      return jsonResponse({ results: { tags: [tag] } });
    }
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({ results: [{ entity_id: `ent:${query}`, name: query, type: "urn:entity:movie" }] });
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse(localityBody([
        { entity_id: "place:shanghai", name: "上海爵士馆", tags: [{ name: "Jazz Club" }], properties: { geocode: { name: "上海", latitude: 31.23, longitude: 121.47 } }, query: { affinity: 0.8 } },
      ]));
    }
    throw new Error(`unexpected ${href}`);
  };
  const result = await handleQlooRequest(input, {
    env: { QLOO_API_KEY: SECRET },
    cache: new Map(),
    fetchImpl,
  });
  assert.equal(result.reason, null);
  assert.equal(result.insight.source, "live");
  assert.equal(result.insight.members.length, 3);
  assert.ok(result.insight.fairness);
  assert.ok(result.insight.routePlan);
  assert.ok(result.insight.members.every((member) => member.entities.length === 3));
  assert.equal(result.insight.suggestions[0].memberScores.m1, 0.8);
  assert.ok(result.insight.requestLog.length > 0);
  assert.ok(result.insight.requestLog.every((entry) => entry.city === "上海"));
  assert.ok(result.insight.requestLog.every((entry) => entry.coordinates.lat === 31.2304));
  assert.ok(result.insight.requestLog.every((entry) => (
    entry.type
    && entry.entity
    && Array.isArray(entry.tags)
    && typeof entry.url === "string"
    && Object.prototype.hasOwnProperty.call(entry, "resultSummary")
  )));
  const tagRequests = result.insight.requestLog.filter((entry) => entry.type === "tags");
  assert.ok(tagRequests.length > 0);
  assert.ok(tagRequests.every((entry) => entry.tags.length > 0));
  assert.ok(tagRequests.every((entry) => entry.resultSummary.count > 0));
  assert.equal(result.insight.requestStats.total, result.insight.requestLog.length);
  assert.ok(result.insight.quota.used >= result.insight.requestStats.total);
  const joined = result.insight.requestLog.map((entry) => JSON.stringify(entry)).join("\\n");
  assert.equal(joined.includes("40.7484"), false);
});

test("members harness is serial, retries 429, and reuses request cache", async () => {
  const input = {
    context: { city: "上海", coordinates: { lat: 31.2304, lng: 121.4737, radiusM: 9000 } },
    members: [
      { id: "m1", preferences: ["电影", "爵士", "火锅"] },
      { id: "m2", preferences: ["展览", "摇滚", "烧烤"] },
      { id: "m3", preferences: ["喜剧", "民谣", "面食"] },
    ],
  };
  const cache = new Map();
  const counts = new Map();
  let inFlight = 0;
  let maxInFlight = 0;
  let firstSearch = "";
  const fetchImpl = async (url) => {
    const href = String(url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const count = (counts.get(href) || 0) + 1;
      counts.set(href, count);
      if (href.includes("/v2/tags")) {
        const query = new URL(href).searchParams.get("filter.query");
        const tag = query === "restaurant" ? VENUE_TAGS.restaurant : VENUE_TAGS["jazz club"];
        return jsonResponse({ results: { tags: [tag] } });
      }
      if (href.includes("/search")) {
        if (!firstSearch) firstSearch = href;
        if (href === firstSearch && count < 3) return jsonResponse({ error: "slow down" }, 429);
        const query = new URL(href).searchParams.get("query");
        return jsonResponse({ results: [{ entity_id: `ent:${query}`, name: query, type: "urn:entity:movie" }] });
      }
      if (href.includes("/v2/insights")) {
        return jsonResponse(localityBody([
          { entity_id: "place:shanghai", name: "上海爵士馆", tags: [{ name: "Jazz Club" }], properties: { geocode: { name: "上海", latitude: 31.23, longitude: 121.47 } } },
        ]));
      }
      throw new Error(`unexpected ${href}`);
    } finally {
      inFlight -= 1;
    }
  };
  const first = await resolveMembersHarness(parseTastes(input), {
    apiKey: SECRET,
    cache,
    fetchImpl,
    rateLimitBackoffMs: [0, 0],
    quotaLimit: 100,
  });
  assert.equal(maxInFlight, 1);
  assert.ok(first.requestStats.rateLimited >= 2);
  assert.ok(first.requestStats.retries >= 2);
  assert.equal(first.quota.limit, 100);
  assert.equal(first.quota.used, first.requestStats.network);
  assert.ok(first.requestLog.every((entry) => entry.type && entry.query && entry.city === "上海"));
  const callsAfterFirst = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const second = await resolveMembersHarness(parseTastes(input), { apiKey: SECRET, cache, fetchImpl, rateLimitBackoffMs: [0, 0] });
  const callsAfterSecond = [...counts.values()].reduce((sum, value) => sum + value, 0);
  assert.equal(callsAfterSecond, callsAfterFirst);
  assert.equal(second.cached, true);
  assert.ok(second.requestStats.cacheHits > 0);
  assert.ok(second.requestLog.every((entry) => entry.source === "cache"));
});

test("members harness marks missing key as fallback without qloo entities", async () => {
  let called = false;
  const input = {
    context: { city: "上海" },
    members: [
      { id: "m1", preferences: ["电影", "爵士", "火锅"] },
      { id: "m2", preferences: ["展览", "摇滚", "烧烤"] },
      { id: "m3", preferences: ["喜剧", "民谣", "面食"] },
    ],
  };
  const result = await handleQlooRequest({ ...input, mode: "members-harness" }, {
    env: {},
    fetchImpl: () => {
      called = true;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, false);
  assert.equal(result.reason, "missing_key");
  assert.equal(result.insight.source, "fallback");
  assert.equal(result.insight.fromQloo, false);
  assert.ok(result.insight.members.every((member) => member.entities.every((entity) => entity.sourceTag === "mock:fixture")));
  assert.equal(JSON.stringify(result).includes("qloo:entity"), false);
});

test("browser client forwards dynamic context to the server proxy", async () => {
  let posted = null;
  const client = createBrowserQlooClient({
    fetchImpl: async (_url, init) => {
      posted = JSON.parse(init.body);
      return jsonResponse({ insight: { source: "fallback", fromQloo: false } });
    },
  });
  await client.resolvePair(parseTastes(DEMO_INPUT));
  assert.deepEqual(posted.context.coordinates, { lat: 40.7484, lng: -73.9857, radiusM: 12000 });
});

test("members harness fallback keeps failed request audit", async () => {
  const input = {
    mode: "members-harness",
    context: { city: "上海", coordinates: { lat: 31.2304, lng: 121.4737 } },
    members: [
      { id: "m1", preferences: ["电影", "爵士", "火锅"] },
      { id: "m2", preferences: ["展览", "摇滚", "烧烤"] },
      { id: "m3", preferences: ["喜剧", "民谣", "面食"] },
    ],
  };
  const result = await handleQlooRequest(input, {
    env: { QLOO_API_KEY: SECRET },
    cache: new Map(),
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(result.reason, "down");
  assert.equal(result.insight.source, "fallback");
  assert.ok(result.insight.requestStats.total > 0);
  assert.ok(result.insight.requestStats.failed > 0);
  assert.ok(result.insight.quota.used > 0);
  assert.ok(result.insight.requestLog.every((entry) => entry.city === "上海"));
});
