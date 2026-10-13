import { parseTastes } from "../src/pipeline/parse.js";
import { interpret } from "../src/qloo/interpret.js";
import { createMockClient } from "../src/qloo/mock.js";

const HACKATHON_BASE = "https://hackathon.api.qloo.com";
const RATE_LIMIT_BACKOFF_MS = [400, 900];
const DEMO_CITY = "New York City";
const CACHE_LABEL = "Qloo 实时结果（已缓存）";
const FALLBACK_MARK = "这次是备用数据";
const TAG_CACHE_KEY = "__venueTagIds";
const mock = createMockClient();
const defaultCache = new Map();

const TAG_QUERIES = [
  { query: "restaurant", types: "urn:tag:category:place,urn:tag:genre:place" },
  { query: "bar", types: "urn:tag:category:place" },
  { query: "live music", types: "urn:tag:category:place" },
  { query: "jazz club", types: "urn:tag:category:place" },
  { query: "night club", types: "urn:tag:category:place" },
];

const TAG_NAMES = new Set([
  "restaurant",
  "bar",
  "pub",
  "nightclub",
  "night club",
  "live music venue",
  "live music",
  "jazz club",
  "music venue",
  "cocktail bar",
  "diner",
  "cafe",
  "café",
  "izakaya",
]);

const LODGING = /hotel|apartment|resort|hostel|motel|lodging|landmark|memorial|museum|tower|suite|\binn\b|公寓|酒店|旅馆|地标/i;
const VENUE = /restaurant|bar|club|jazz|music|diner|cafe|café|pub|izakaya|food|drink|cocktail|venue|grill|kitchen|noodle|ramen|bistro|tavern|lounge|performance|concert|eatery/i;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSerialQueue() {
  let chain = Promise.resolve();
  return (task) => {
    const result = chain.then(task, task);
    chain = result.then(
      () => {},
      () => {},
    );
    return result;
  };
}

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

function normName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tagList(item) {
  if (!Array.isArray(item?.tags)) return [];
  return item.tags.map((tag) => (typeof tag === "string" ? tag : tag?.name)).filter(Boolean);
}

function asTags(json) {
  if (Array.isArray(json?.results?.tags)) return json.results.tags;
  return asList(json);
}

function acceptTag(tag) {
  const id = String(tag?.id || tag?.entity_id || "");
  const name = normName(tag?.name || tag?.title);
  if (!TAG_NAMES.has(name)) return "";
  if (id.startsWith("urn:tag:category:place:")) return id;
  if (name === "restaurant" && id.startsWith("urn:tag:genre:place:restaurant")) return id;
  return "";
}

function localityOf(json) {
  const signal = json?.query?.locality?.signal || json?.query?.locality;
  if (!signal || typeof signal !== "object") return null;
  const name = signal.name || signal.title;
  if (!name) return null;
  return { name: String(name), id: String(signal.entity_id || signal.id || "") };
}

function cityOf(item) {
  const name = item?.properties?.geocode?.name || item?.geocode?.name || "";
  return name ? String(name) : "";
}

function isSameCity(item) {
  const city = cityOf(item);
  if (!city) return true;
  return /new york/i.test(city);
}

function isVenue(item) {
  const tags = tagList(item);
  const blob = `${item?.name || ""} ${tags.join(" ")}`;
  if (LODGING.test(blob)) return false;
  return VENUE.test(blob);
}

function fallbackWarning(detail) {
  return `${FALLBACK_MARK}。${detail}`;
}

async function qlooGetOnce(url, { apiKey, timeoutMs, fetchImpl }) {
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

async function qlooGet(url, options) {
  const attempt = async () => {
    for (let index = 0; index <= RATE_LIMIT_BACKOFF_MS.length; index += 1) {
      try {
        return await qlooGetOnce(url, options);
      } catch (error) {
        const retry = error?.code === "RATE_LIMIT" && index < RATE_LIMIT_BACKOFF_MS.length;
        if (!retry) throw error;
        await delay(RATE_LIMIT_BACKOFF_MS[index]);
      }
    }
  };
  return options.enqueue ? options.enqueue(attempt) : attempt();
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
  for (const [type, ids] of groups) {
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
  }
  return { results: { entities: found } };
}

async function lookupVenueTags(options, cache) {
  const cached = cache.get(TAG_CACHE_KEY);
  if (Array.isArray(cached) && cached.length) return cached;
  const ids = new Set();
  for (const query of TAG_QUERIES) {
    const json = await qlooGet(
      `${HACKATHON_BASE}/v2/tags?${new URLSearchParams({
        "filter.query": query.query,
        "filter.tag.types": query.types,
        take: "20",
      })}`,
      options,
    );
    for (const tag of asTags(json)) {
      const id = acceptTag(tag);
      if (id) ids.add(id);
    }
  }
  const list = [...ids];
  if (list.length) cache.set(TAG_CACHE_KEY, list);
  return list;
}

function sideAffinities(json) {
  const scores = new Map();
  for (const item of asList(json)) {
    const id = String(item?.entity_id || item?.id || "");
    if (id && typeof item?.query?.affinity === "number") scores.set(id, item.query.affinity);
  }
  return scores;
}

async function liveResolve(parsed, options) {
  const opts = { ...options, enqueue: createSerialQueue() };
  const cache = options.cache || defaultCache;
  const tagIds = await lookupVenueTags(opts, cache);
  if (!tagIds.length) {
    const error = new Error("Qloo tag lookup returned no food or music venue tags");
    error.code = "DOWN";
    throw error;
  }
  const a = [];
  for (const item of parsed.a) a.push(await searchOne(item, opts));
  const b = [];
  for (const item of parsed.b) b.push(await searchOne(item, opts));
  const idsOf = (entries) =>
    entries
      .map((entry) => asList(entry.search)[0])
      .map((item) => item?.entity_id || item?.id)
      .filter(Boolean)
      .map(String);
  const aIds = idsOf(a);
  const bIds = idsOf(b);
  const aAffinity = await affinityAgainst(a, bIds, opts);
  const bAffinity = await affinityAgainst(b, aIds, opts);
  const relationships = {
    results: { entities: [...asList(aAffinity), ...asList(bAffinity)] },
  };
  const signalIds = [...aIds, ...bIds];
  if (!signalIds.length) {
    const error = new Error("Qloo search returned no entity ids");
    error.code = "DOWN";
    throw error;
  }
  const discovered = await qlooGet(
    insightsUrl({
      "filter.type": "urn:entity:place",
      "signal.interests.entities": signalIds.join(","),
      "filter.location.query": DEMO_CITY,
      "filter.location.radius": "0",
      "filter.tags": tagIds.join(","),
      "operator.filter.tags": "union",
      take: "8",
    }),
    opts,
  );
  const locality = localityOf(discovered);
  if (!locality || !/new york/i.test(locality.name)) {
    const error = new Error("Qloo did not honor the city filter");
    error.code = "DOWN";
    throw error;
  }
  const venues = asList(discovered).filter((item) => isVenue(item) && isSameCity(item)).slice(0, 4);
  if (!venues.length) {
    const error = new Error("Qloo city filter returned no food or music venue");
    error.code = "DOWN";
    throw error;
  }
  const placeIds = venues.map((item) => String(item.entity_id || item.id)).filter(Boolean);
  const scoreSide = async (ids) => {
    if (!ids.length || !placeIds.length) return new Map();
    try {
      const json = await qlooGet(
        insightsUrl({
          "filter.type": "urn:entity:place",
          "signal.interests.entities": ids.join(","),
          "filter.results.entities": placeIds.join(","),
          "filter.location.query": DEMO_CITY,
          "filter.location.radius": "0",
          take: "8",
        }),
        opts,
      );
      return sideAffinities(json);
    } catch (error) {
      if (error?.code === "RATE_LIMIT" || error?.code === "TIMEOUT") throw error;
      return new Map();
    }
  };
  const [scoresA, scoresB] = [await scoreSide(aIds), await scoreSide(bIds)];
  const stamped = venues.map((item) => {
    const id = String(item.entity_id || item.id || "");
    const next = { ...item };
    if (scoresA.has(id)) next.affinityA = scoresA.get(id);
    if (scoresB.has(id)) next.affinityB = scoresB.get(id);
    const city = cityOf(item);
    if (city) next.city = city;
    return next;
  });
  return interpret({
    a,
    b,
    insights: { results: { entities: stamped } },
    relationships,
    locality,
    venueTagIds: tagIds,
  });
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

export function resolveApiKey(raw) {
  const trimmed = String(raw || "").trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length < 64 || trimmed.length % 2 !== 0) return trimmed;
  const bytes = Buffer.from(trimmed, "hex");
  for (let index = 0; index < bytes.length; index += 1) bytes[index] ^= 0x5a;
  return bytes.toString("utf8");
}

export async function handleQlooRequest(body, options = {}) {
  const env = options.env || {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cache = options.cache || defaultCache;
  const apiKey = resolveApiKey(env.QLOO_API_KEY);
  const timeoutMs = Number(env.QLOO_TIMEOUT_MS || 8000);
  let parsed;
  try {
    parsed = parseTastes({ a: body?.a, b: body?.b });
  } catch (error) {
    return { ok: false, reason: "bad_input", warning: error.message, insight: null };
  }

  if (body?.preview === "rate_limit") {
    const insight = await withMock(parsed, "rate_limit", fallbackWarning("预览：限流回退。行程是规则基线，来源标记 mock:fixture。这不是一次测到的真实 429。"));
    return { ok: false, reason: "rate_limit", warning: insight.warning, insight };
  }

  const cacheKey = JSON.stringify({ parsed, live: Boolean(apiKey) });
  if (!body?.preview && cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (cached?.ok === true && cached?.reason == null && cached?.insight?.source === "live") {
      return {
        ...cached,
        warning: CACHE_LABEL,
        insight: { ...cached.insight, cached: true, cacheLabel: CACHE_LABEL, warning: CACHE_LABEL },
      };
    }
    return { ...cached, insight: cached.insight ? { ...cached.insight, cached: true } : cached.insight };
  }

  let payload;
  if (!apiKey) {
    const insight = await withMock(
      parsed,
      "missing_key",
      fallbackWarning("服务器没有密钥，没有调用 Qloo。下面是规则基线，来源标记 mock:fixture。"),
    );
    payload = { ok: true, reason: "missing_key", warning: insight.warning, insight };
  } else {
    try {
      const insight = await liveResolve(parsed, { apiKey, timeoutMs, fetchImpl, cache });
      payload = { ok: true, reason: null, warning: insight.warning, insight };
    } catch (error) {
      const reason =
        error?.code === "RATE_LIMIT" ? "rate_limit" : error?.code === "TIMEOUT" ? "timeout" : "down";
      const warning = fallbackWarning(
        reason === "rate_limit"
          ? "Qloo 限流。页面改显示规则基线，来源标记 mock:fixture。"
          : reason === "timeout"
            ? "Qloo 超时。页面改显示规则基线，来源标记 mock:fixture。"
            : "Qloo 不可用。页面改显示规则基线，来源标记 mock:fixture。",
      );
      const insight = await withMock(parsed, reason, warning);
      payload = { ok: false, reason, warning, insight };
    }
  }

  const cacheable = payload.reason === "missing_key" || (payload.ok === true && payload.reason == null);
  if (cacheable) cache.set(cacheKey, payload);
  return payload;
}
