import { parseTastes } from "../src/pipeline/parse.js";
import { createMockClient } from "../src/qloo/mock.js";

const mock = createMockClient();
const defaultCache = new Map();

function asList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.entities)) return json.entities;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.results?.entities)) return json.results.entities;
  return [];
}

function readEntity(item) {
  if (!item || typeof item !== "object") return null;
  const id = item.id || item.entity_id || item.entityId || "";
  const name = item.name || item.title || item.label || "";
  if (!id && !name) return null;
  return { id: String(id), name: String(name) };
}

async function qlooFetch(url, { apiKey, timeoutMs, fetchImpl, method = "GET", body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers: {
        "X-Api-Key": apiKey,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (response.status === 429) {
      const error = new Error("Qloo rate limited");
      error.code = "RATE_LIMIT";
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Qloo ${response.status}`);
      error.code = response.status >= 500 ? "DOWN" : "DOWN";
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

async function liveResolve(parsed, { apiKey, baseUrl, timeoutMs, fetchImpl }) {
  const root = String(baseUrl || "https://hackathon.api.qloo.com").replace(/\/$/, "");
  async function searchOne(query) {
    const json = await qlooFetch(`${root}/search?query=${encodeURIComponent(query)}&limit=5`, {
      apiKey,
      timeoutMs,
      fetchImpl,
    });
    const entity = asList(json).map(readEntity).find(Boolean);
    if (!entity) {
      const error = new Error(`Qloo search returned no entity for ${query}`);
      error.code = "DOWN";
      throw error;
    }
    return entity;
  }

  const a = [];
  const b = [];
  for (const item of parsed.a) {
    const entity = await searchOne(item.value);
    a.push({ ...entity, kind: item.key, query: item.value, source: "qloo" });
  }
  for (const item of parsed.b) {
    const entity = await searchOne(item.value);
    b.push({ ...entity, kind: item.key, query: item.value, source: "qloo" });
  }
  const ids = [...a, ...b].map((entity) => entity.id).filter(Boolean);
  let suggestions = [];
  if (ids.length) {
    const json = await qlooFetch(`${root}/v2/insights`, {
      apiKey,
      timeoutMs,
      fetchImpl,
      method: "POST",
      body: {
        "filter.type": "urn:entity:place",
        "signal.interests.entities": ids.join(","),
        limit: 4,
      },
    });
    suggestions = asList(json).map(readEntity).filter(Boolean).slice(0, 4);
  }
  return {
    source: "live",
    reason: null,
    warning: suggestions.length
      ? "Qloo 返回了实体和建议地点。亲和度分数还没接上，冲突仍按本地规则。"
      : "Qloo 返回了实体。亲和度分数还没接上，冲突仍按本地规则。",
    cached: false,
    entities: { a, b },
    suggestions,
    tensions: null,
    overlap: { name: "都会夜生活", nameEn: "Urban nightlife" },
  };
}

function withFallback(parsed, reason, warning) {
  return mock.resolvePair(parsed).then((fallback) => ({
    ...fallback,
    source: "fallback",
    reason,
    warning,
  }));
}

export async function handleQlooRequest(body, options = {}) {
  const env = options.env || {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cache = options.cache || defaultCache;
  const apiKey = String(env.QLOO_API_KEY || "").trim();
  const baseUrl = env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
  const timeoutMs = Number(env.QLOO_TIMEOUT_MS || 8000);
  let parsed;
  try {
    parsed = parseTastes({ a: body?.a, b: body?.b });
  } catch (error) {
    return { ok: false, reason: "bad_input", warning: error.message, insight: null };
  }

  if (body?.preview === "rate_limit") {
    const insight = await withFallback(parsed, "rate_limit", "预览：限流回退。这不是一次测到的真实 429。");
    return { ok: false, reason: "rate_limit", warning: insight.warning, insight };
  }

  const cacheKey = JSON.stringify({ parsed, live: Boolean(apiKey) });
  if (!body?.preview && cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    return { ...cached, insight: { ...cached.insight, cached: true } };
  }

  let payload;
  if (!apiKey) {
    const insight = await withFallback(
      parsed,
      "missing_key",
      "服务器没有密钥，所以没有调用 Qloo。下面是本地假数据。",
    );
    payload = { ok: false, reason: "missing_key", warning: insight.warning, insight };
  } else {
    try {
      const insight = await liveResolve(parsed, { apiKey, baseUrl, timeoutMs, fetchImpl });
      payload = { ok: true, reason: null, warning: insight.warning, insight };
    } catch (error) {
      const reason =
        error?.code === "RATE_LIMIT" ? "rate_limit" : error?.code === "TIMEOUT" ? "timeout" : "down";
      const warning =
        reason === "rate_limit"
          ? "Qloo 限流。页面改显示本地假数据。"
          : reason === "timeout"
            ? "Qloo 超时。页面改显示本地假数据。"
            : "Qloo 不可用。页面改显示本地假数据。";
      const insight = await withFallback(parsed, reason, warning);
      payload = { ok: false, reason, warning, insight };
    }
  }

  cache.set(cacheKey, payload);
  return payload;
}
