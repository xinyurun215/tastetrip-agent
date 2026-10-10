import { parseTastes } from "../src/pipeline/parse.js";
import { interpret } from "../src/qloo/interpret.js";
import { replayResolve } from "../src/qloo/replay.js";

const defaultCache = new Map();

function asList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.entities)) return json.entities;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.results?.entities)) return json.results.entities;
  return [];
}

function hasEntity(json) {
  return asList(json).some((item) => item && typeof item === "object" && (item.name || item.title || item.entity_id || item.id));
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
  async function searchOne(item) {
    const json = await qlooFetch(`${root}/search?query=${encodeURIComponent(item.value)}&limit=5`, {
      apiKey,
      timeoutMs,
      fetchImpl,
    });
    if (!hasEntity(json)) {
      const error = new Error(`Qloo search returned no entity for ${item.value}`);
      error.code = "DOWN";
      throw error;
    }
    return { kind: item.key, query: item.value, search: json };
  }

  const a = [];
  const b = [];
  for (const item of parsed.a) a.push(await searchOne(item));
  for (const item of parsed.b) b.push(await searchOne(item));
  const ids = [...a, ...b]
    .map((entry) => asList(entry.search)[0])
    .map((item) => item?.entity_id || item?.id)
    .filter(Boolean);
  let insights = { results: [] };
  if (ids.length) {
    insights = await qlooFetch(`${root}/v2/insights`, {
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
  }
  return interpret({ a, b, insights, relationships: null }, "live");
}

function withReplay(parsed, reason, warning) {
  const insight = replayResolve(parsed);
  return {
    ...insight,
    reason,
    warning: warning || insight.warning,
  };
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
    const insight = withReplay(parsed, "rate_limit", "预览：限流回退。行程是录好的 Qloo 回放，不是手写四站。这不是一次测到的真实 429。");
    return { ok: false, reason: "rate_limit", warning: insight.warning, insight };
  }

  const cacheKey = JSON.stringify({ parsed, live: Boolean(apiKey) });
  if (!body?.preview && cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    return { ...cached, insight: { ...cached.insight, cached: true } };
  }

  let payload;
  if (!apiKey) {
    const insight = withReplay(parsed, "replay");
    payload = { ok: true, reason: "replay", warning: insight.warning, insight };
  } else {
    try {
      const insight = await liveResolve(parsed, { apiKey, baseUrl, timeoutMs, fetchImpl });
      payload = { ok: true, reason: null, warning: insight.warning, insight };
    } catch (error) {
      const reason =
        error?.code === "RATE_LIMIT" ? "rate_limit" : error?.code === "TIMEOUT" ? "timeout" : "down";
      const warning =
        reason === "rate_limit"
          ? "Qloo 限流。页面改显示录好的 Qloo 回放。"
          : reason === "timeout"
            ? "Qloo 超时。页面改显示录好的 Qloo 回放。"
            : "Qloo 不可用。页面改显示录好的 Qloo 回放。";
      const insight = withReplay(parsed, reason, warning);
      payload = { ok: false, reason, warning, insight };
    }
  }

  cache.set(cacheKey, payload);
  return payload;
}
