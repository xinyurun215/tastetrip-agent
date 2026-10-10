import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_INPUT } from "../src/data.js";
import { handleQlooRequest } from "../server/handleQloo.js";
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

test("missing server key does not call Qloo and still returns a mock insight", async () => {
  let called = false;
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: {},
    cache: new Map(),
    fetchImpl() {
      called = true;
      throw new Error("should not fetch");
    },
  });
  assert.equal(called, false);
  assert.equal(result.reason, "missing_key");
  assert.equal(result.insight.source, "fallback");
  assert.equal(result.insight.entities.a.length, 3);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("rate limit falls back with a route the page can render", async () => {
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET, QLOO_TIMEOUT_MS: "1000" },
    cache: new Map(),
    fetchImpl: async () => jsonResponse({ error: "slow down" }, 429),
  });
  assert.equal(result.reason, "rate_limit");
  assert.equal(result.insight.source, "fallback");
  assert.equal(result.insight.entities.b.length, 3);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("timeout falls back and the next identical call is cached", async () => {
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
  assert.equal(second.insight.cached, true);
  assert.equal(fetches, callsAfterFirst);
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
  assert.equal(result.ok, true);
  assert.equal(result.insight.source, "live");
  assert.equal(result.insight.tensions, null);
  assert.equal(result.insight.suggestions[0].name, "Night counter");
  assert.match(result.insight.warning, /亲和度/);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
  assert.equal("score" in result.insight, false);
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
  assert.equal(first.entities.a[0].id.startsWith("mock:"), true);
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
  assert.match(result.warning, /预览/);
});
