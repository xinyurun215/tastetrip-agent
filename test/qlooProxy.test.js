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

test("missing server key replays the fixture and does not call Qloo", async () => {
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
  assert.equal(result.reason, "replay");
  assert.equal(result.insight.source, "replay");
  assert.equal(result.insight.fromQloo, true);
  assert.equal(result.insight.entities.a[0].name, "The Grand Budapest Hotel");
  assert.equal(result.insight.entities.a[0].affinity, 0.22);
  assert.equal(body.includes("mock:fixture"), false);
  assert.equal(body.includes("qloo:replay"), true);
  assert.equal(body.includes(SECRET), false);
});

test("rate limit falls back with a route the page can render", async () => {
  const result = await handleQlooRequest(DEMO_INPUT, {
    env: { QLOO_API_KEY: SECRET, QLOO_TIMEOUT_MS: "1000" },
    cache: new Map(),
    fetchImpl: async () => jsonResponse({ error: "slow down" }, 429),
  });
  assert.equal(result.reason, "rate_limit");
  assert.equal(result.insight.source, "replay");
  assert.equal(result.insight.suggestions[0].name, "Szimpla Night Court");
  assert.equal(JSON.stringify(result).includes("mock:fixture"), false);
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
  assert.equal(first.insight.source, "replay");
  assert.equal(JSON.stringify(first).includes("mock:fixture"), false);
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
  assert.equal(result.insight.source, "replay");
  assert.equal(result.insight.suggestions[0].name, "Szimpla Night Court");
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
  assert.equal(first.source, "replay");
  assert.equal(first.reason, "offline");
  assert.equal(first.entities.a[0].id.startsWith("mock:"), false);
  assert.equal(first.entities.a[0].sourceTag, "qloo:entity");
  assert.match(JSON.stringify(first), /qloo:replay/);
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
