import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_INPUT } from "../src/data.js";
import { handleQlooRequest, resolveApiKey } from "../server/handleQloo.js";
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

function xorHex(text) {
  const bytes = Buffer.from(text, "utf8");
  for (let index = 0; index < bytes.length; index += 1) bytes[index] ^= 0x5a;
  return bytes.toString("hex");
}

const SYNTHETIC = "synthetic-local-key-0123456789abcdef";

test("a long even hex env value is XOR-decoded before the request", async () => {
  const encoded = xorHex(SYNTHETIC);
  assert.equal(encoded.length >= 64 && encoded.length % 2 === 0, true);
  let sent = "";
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: encoded },
    cache: new Map(),
    fetchImpl(_url, init) {
      sent = init.headers["X-Api-Key"];
      return jsonResponse({ error: "slow down" }, 429);
    },
  });
  assert.equal(resolveApiKey(encoded), SYNTHETIC);
  assert.equal(sent, SYNTHETIC);
  assert.equal(resolveApiKey(SECRET), SECRET);
  assert.equal(resolveApiKey(""), "");
  assert.equal(resolveApiKey("abcd"), "abcd");
  const body = JSON.stringify(result);
  assert.equal(body.includes(encoded), false);
  assert.equal(body.includes(SYNTHETIC), false);
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
    const href = String(url);
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({ results: [{ id: `ent:${query}`, name: query }] });
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse({ results: [{ id: "place:1", name: "Night counter" }] });
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
  assert.equal(result.insight.tensions[0].a.title, "《布达佩斯大饭店》");
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
    const href = String(url);
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({ results: [{ entity_id: `ent:${query}`, name: query, query: { affinity: 0.42 } }] });
    }
    if (href.includes("/v2/insights")) {
      return jsonResponse({ results: [{ entity_id: "place:1", name: "Night counter", query: { affinity: 0.77 } }] });
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
      return jsonResponse({
        results: {
          entities: [{ entity_id: "urn:entity:place:night-counter", name: "Night counter", type: "urn:entity:place", query: { affinity: 0.77 } }],
        },
      });
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
  const place = calls.find((call) => call.url.includes("filter.type=urn%3Aentity%3Aplace") || call.url.includes("filter.type=urn:entity:place"));
  assert.ok(place);
  assert.equal(place.url.includes("signal.interests.entities="), true);
  assert.equal(place.url.includes("take=4"), true);
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
      if (href.includes("/search")) {
        const query = new URL(href).searchParams.get("query");
        return jsonResponse({
          results: [{ entity_id: `ent:${query}`, name: query, type: "urn:entity:movie" }],
        });
      }
      if (href.includes("/v2/insights")) return jsonResponse({ results: { entities: [] } });
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
  assert.equal(downCalls, 2);

  let liveCalls = 0;
  const liveCache = new Map();
  const liveFetch = async (url) => {
    liveCalls += 1;
    const href = String(url);
    if (href.includes("/search")) {
      const query = new URL(href).searchParams.get("query");
      return jsonResponse({ results: [{ id: `ent:${query}`, name: query }] });
    }
    if (href.includes("/v2/insights")) return jsonResponse({ results: [{ id: "place:1", name: "Night counter" }] });
    throw new Error(`unexpected ${href}`);
  };
  const firstLive = await handleQlooRequest(DEMO_INPUT, { env, cache: liveCache, fetchImpl: liveFetch });
  const afterLive = liveCalls;
  const secondLive = await handleQlooRequest(DEMO_INPUT, { env, cache: liveCache, fetchImpl: liveFetch });
  assert.equal(firstLive.ok, true);
  assert.equal(firstLive.reason, null);
  assert.equal(secondLive.insight.cached, true);
  assert.equal(liveCalls, afterLive);
});
