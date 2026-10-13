import { parseTastes } from "../src/pipeline/parse.js";
import { interpret } from "../src/qloo/interpret.js";
import { createMockClient } from "../src/qloo/mock.js";

const HACKATHON_BASE = "https://hackathon.api.qloo.com";
const mock = createMockClient();
const defaultCache = new Map();

const INSIGHTS_TYPES = new Set([
  "urn:entity:artist",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:destination",
  "urn:entity:movie",
  "urn:entity:person",
  "urn:entity:place",
  "urn:entity:podcast",
  "urn:entity:tv_show",
  "urn:entity:video_game",
]);

const SEARCH_TYPES = {
  work: "urn:entity:movie,urn:entity:tv_show,urn:entity:brand",
  music: "urn:entity:artist",
  food: "urn:entity:place,urn:entity:brand",
};

function asList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.results?.entities)) return json.results.entities;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.entities)) return json.entities;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

function hasEntity(json) {
  return asList(json).some((item) => item && typeof item === "object" && (item.name || item.title || item.entity_id || item.id));
}

function entityType(item) {
  const raw = item?.type || (Array.isArray(item?.types) ? item.types[0] : "");
  return INSIGHTS_TYPES.has(raw) ? raw : "";
}

function insightsUrl(params) {
  return `${HACKATHON_BASE}/v2/insights?${new URLSearchParams(params)}`;
}

async function qlooGet(url, { apiKey, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (response.status === 429) {
      const error = new Error("Qloo rate limited");
      error.code = "RATE_LIMIT";
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Qloo ${response.status}`);
      error.code = "DOWN";
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeout = new Error(`Qloo timed out after ${timeoutMs}ms`);
      timeout.code = "TIMEOUT";
      throw timeout;
    }
    if (error?.code === "RATE_LIMIT" || error?.code === "TIMEOUT" || error?.code === "DOWN") throw error;
    const down = new Error(error?.message || "Qloo unreachable");
    down.code = "DOWN";
    throw down;
  } finally {
    clearTimeout(timer);
  }
}

async function searchOne(item, options) {
  const typed = `${HACKATHON_BASE}/search?${new URLSearchParams({
    query: item.value,
    types: SEARCH_TYPES[item.key] || SEARCH_TYPES.work,
    take: "5",
  })}`;
  let json = await qlooGet(typed, options);
  if (!hasEntity(json)) {
    const plain = `${HACKATHON_BASE}/search?${new URLSearchParams({ query: item.value, take: "5" })}`;
    json = await qlooGet(plain, options);
  }
  if (!hasEntity(json)) {
    const error = new Error(`Qloo search returned no entity for ${item.value}`);
    error.code = "DOWN";
    throw error;
  }
  return { kind: item.key, query: item.value, search: json };
}

async function affinityAgainst(entities, signalIds, options) {
  const groups = new Map();
  for (const entity of entities) {
    const type = entityType(asList(entity.search)[0]);
    const id = asList(entity.search)[0]?.entity_id || asList(entity.search)[0]?.id;
    if (!type || !id || !signalIds.length) continue;
    const bucket = groups.get(type) || [];
    bucket.push(String(id));
    groups.set(type, bucket);
  }
  const found = [];
  await Promise.all(
    [...groups.entries()].map(async ([type, ids]) => {
      try {
        const json = await qlooGet(
          insightsUrl({
            "filter.type": type,
            "signal.interests.entities": signalIds.join(","),
            "filter.results.entities": ids.join(","),
            take: "10",
          }),
          options,
        );
        for (const item of asList(json)) {
          const id = String(item?.entity_id || item?.id || "");
          if (ids.includes(id) && typeof item?.query?.affinity === "number") found.push(item);
        }
      } catch (error) {
        if (error?.code === "RATE_LIMIT" || error?.code === "TIMEOUT") throw error;
      }
    }),
  );
  return { results: { entities: found } };
}

async function liveResolve(parsed, options) {
  const a = await Promise.all(parsed.a.map((item) => searchOne(item, options)));
  const b = await Promise.all(parsed.b.map((item) => searchOne(item, options)));
  const idsOf = (entries) =>
    entries
      .map((entry) => asList(entry.search)[0])
      .map((item) => item?.entity_id || item?.id)
      .filter(Boolean)
      .map(String);
  const aIds = idsOf(a);
  const bIds = idsOf(b);
  const [aAffinity, bAffinity] = await Promise.all([
    affinityAgainst(a, bIds, options),
    affinityAgainst(b, aIds, options),
  ]);
  const relationships = {
    results: { entities: [...asList(aAffinity), ...asList(bAffinity)] },
  };
  let insights = { results: { entities: [] } };
  const signalIds = [...aIds, ...bIds];
  if (signalIds.length) {
    try {
      insights = await qlooGet(
        insightsUrl({
          "filter.type": "urn:entity:place",
          "signal.interests.entities": signalIds.join(","),
          take: "4",
        }),
        options,
      );
    } catch (error) {
      if (error?.code === "RATE_LIMIT" || error?.code === "TIMEOUT") throw error;
    }
  }
  return interpret({ a, b, insights, relationships });
}

async function withMock(parsed, reason, warning) {
  const insight = await mock.resolvePair(parsed);
  return {
    ...insight,
    source: "fallback",
    reason,
    warning,
    fromQloo: false,
  };
}

export async function handleQlooRequest(body, options = {}) {
  const env = options.env || {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cache = options.cache || defaultCache;
  const apiKey = String(env.QLOO_API_KEY || "").trim();
  const timeoutMs = Number(env.QLOO_TIMEOUT_MS || 8000);
  let parsed;
  try {
    parsed = parseTastes({ a: body?.a, b: body?.b });
  } catch (error) {
    return { ok: false, reason: "bad_input", warning: error.message, insight: null };
  }

  if (body?.preview === "rate_limit") {
    const insight = await withMock(parsed, "rate_limit", "预览：限流回退。行程是规则基线，来源标记 mock:fixture。这不是一次测到的真实 429。");
    return { ok: false, reason: "rate_limit", warning: insight.warning, insight };
  }

  const cacheKey = JSON.stringify({ parsed, live: Boolean(apiKey) });
  if (!body?.preview && cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    return { ...cached, insight: { ...cached.insight, cached: true } };
  }

  let payload;
  if (!apiKey) {
    const insight = await withMock(
      parsed,
      "missing_key",
      "服务器没有密钥，没有调用 Qloo。下面是规则基线，来源标记 mock:fixture。",
    );
    payload = { ok: true, reason: "missing_key", warning: insight.warning, insight };
  } else {
    try {
      const insight = await liveResolve(parsed, { apiKey, timeoutMs, fetchImpl });
      payload = { ok: true, reason: null, warning: insight.warning, insight };
    } catch (error) {
      const reason =
        error?.code === "RATE_LIMIT" ? "rate_limit" : error?.code === "TIMEOUT" ? "timeout" : "down";
      const warning =
        reason === "rate_limit"
          ? "Qloo 限流。页面改显示规则基线，来源标记 mock:fixture。"
          : reason === "timeout"
            ? "Qloo 超时。页面改显示规则基线，来源标记 mock:fixture。"
            : "Qloo 不可用。页面改显示规则基线，来源标记 mock:fixture。";
      const insight = await withMock(parsed, reason, warning);
      payload = { ok: false, reason, warning, insight };
    }
  }

  cache.set(cacheKey, payload);
  return payload;
}
