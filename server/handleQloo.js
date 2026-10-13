import { parseTastes } from "../src/pipeline/parse.js";
import { scoreFairness } from "../src/pipeline/fairness.js";
import { planRoute } from "../src/pipeline/routePlanner.js";
import { interpret } from "../src/qloo/interpret.js";
import { createMockClient } from "../src/qloo/mock.js";

const HACKATHON_BASE = "https://hackathon.api.qloo.com";
const RATE_LIMIT_BACKOFF_MS = [400, 900];
const DEFAULT_RADIUS_M = 12000;
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
const MUSIC_HINT = /jazz|live[_\s-]?music|music[_\s-]?venue|night[_\s-]?club|concert|performing[_\s-]?arts|recital|opera/i;

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
  if (!id.startsWith("urn:tag:")) return "";
  if (LODGING.test(name) || LODGING.test(id)) return "";
  if (/supply|grocery|market|\bstore\b/.test(name)) return "";
  const broad = TAG_NAMES.has(name) || VENUE.test(name);
  if (!broad) return "";
  if (id.startsWith("urn:tag:category:place:")) return id;
  if (id.startsWith("urn:tag:genre:place:restaurant") && !id.slice("urn:tag:genre:place:restaurant".length).includes(":")) return id;
  if (/:(bar|pub|jazz_club|live_music_venue|night_club|music_venue|restaurant)$/.test(id)) return id;
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

function scanPlace(item) {
  const addressFields = new Set();
  const coordFields = new Set();
  const hourFields = new Set();
  let lat = null;
  let lng = null;
  let address = "";
  const walk = (value, path, depth) => {
    if (!value || typeof value !== "object" || depth > 5) return;
    if (Array.isArray(value)) {
      if (value.length && value[0] && typeof value[0] === "object") walk(value[0], `${path}[]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "tags" || key === "akas") continue;
      const here = path ? `${path}.${key}` : key;
      const lower = key.toLowerCase();
      if (/address|street/.test(lower)) {
        addressFields.add(here);
        if (!address && typeof child === "string") address = child.slice(0, 180);
      }
      if (/hour|opening|schedule/.test(lower)) hourFields.add(here);
      if ((lower === "lat" || lower === "latitude") && typeof child === "number") {
        coordFields.add(here);
        lat = child;
      }
      if ((lower === "lng" || lower === "lon" || lower === "long" || lower === "longitude") && typeof child === "number") {
        coordFields.add(here);
        lng = child;
      }
      if (typeof child === "string") {
        const point = child.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
        if (point) {
          coordFields.add(here);
          lng = Number(point[1]);
          lat = Number(point[2]);
        }
      } else if (child && typeof child === "object") walk(child, here, depth + 1);
    }
  };
  walk(item, "", 0);
  return { addressFields: [...addressFields], coordFields: [...coordFields], hourFields: [...hourFields], lat, lng, address };
}

function coverageOf(scans) {
  const uniq = (key) => [...new Set(scans.flatMap((scan) => scan[key]))];
  return {
    places: scans.length,
    withAddress: scans.filter((scan) => scan.addressFields.length).length,
    withCoords: scans.filter((scan) => scan.lat != null && scan.lng != null).length,
    withHours: scans.filter((scan) => scan.hourFields.length).length,
    addressFields: uniq("addressFields"),
    coordFields: uniq("coordFields"),
    hourFields: uniq("hourFields"),
  };
}

function kmBetween(left, right) {
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(right.lat - left.lat);
  const dLng = rad(right.lng - left.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function placeParams(extra, location = {}) {
  const params = { "filter.type": "urn:entity:place", ...extra };
  if (location.coordinates) {
    params["filter.location"] = `POINT(${location.coordinates.lng} ${location.coordinates.lat})`;
    params["filter.location.radius"] = String(location.coordinates.radiusM || DEFAULT_RADIUS_M);
  }
  return params;
}

function isMusicPlace(item) {
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  const headNames = tagList(item).slice(0, 6).join(" ");
  const headIds = tags
    .slice(0, 6)
    .map((tag) => (typeof tag === "string" ? tag : tag?.id || ""))
    .join(" ");
  return MUSIC_HINT.test(`${item?.name || ""} ${headNames} ${headIds}`);
}

function isLodgingPlace(item) {
  const head = `${item?.name || ""} ${tagList(item).slice(0, 4).join(" ")}`;
  return LODGING.test(head);
}

function isVenue(item) {
  if (isLodgingPlace(item)) return false;
  const blob = `${item?.name || ""} ${tagList(item).join(" ")}`;
  return VENUE.test(blob) || isMusicPlace(item);
}

function tagLane(name) {
  if (MUSIC_HINT.test(name)) return "music";
  if (TAG_NAMES.has(name) || VENUE.test(name)) return "food";
  return "";
}

function pickVenues(musicRaw, foodRaw, location = {}) {
  const seen = new Set();
  const pull = (list, want, mode) => {
    const picked = [];
    for (const item of list) {
      if (picked.length >= want) break;
      const key = String(item?.entity_id || item?.id || item?.name || "");
      if (!key || seen.has(key)) continue;
      if (!isVenue(item) || !isSameCityAt(item, location)) continue;
      const music = isMusicPlace(item);
      if (mode === "music" && !music) continue;
      if (mode === "food" && music) continue;
      seen.add(key);
      picked.push(item);
    }
    return picked;
  };
  const music = pull(musicRaw, 2, "music");
  const food = pull(foodRaw, 4 - music.length, "food");
  const extra = pull([...foodRaw, ...musicRaw], 4 - music.length - food.length, "any");
  return [...music, ...food, ...extra].slice(0, 4);
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
  const requestCache = options.requestCache ? options.cache : null;
  const cacheKey = requestCache ? `__qloo_http:${url}` : "";
  if (requestCache && requestCache.has(cacheKey)) {
    const json = requestCache.get(cacheKey);
    recordRequest(options, { source: "cache", status: "cached", resultSummary: summarizeResult(json) }, url);
    return json;
  }
  const attempt = async () => {
    const backoff = Array.isArray(options.rateLimitBackoffMs) ? options.rateLimitBackoffMs : RATE_LIMIT_BACKOFF_MS;
    for (let index = 0; index <= backoff.length; index += 1) {
      try {
        const json = await qlooGetOnce(url, options);
        if (requestCache) requestCache.set(cacheKey, json);
        recordRequest(options, { source: "qloo", status: "ok", attempt: index + 1, resultSummary: summarizeResult(json) }, url);
        return json;
      } catch (error) {
        const retry = error?.code === "RATE_LIMIT" && index < backoff.length;
        recordRequest(options, { source: "qloo", status: error?.code || "DOWN", attempt: index + 1 }, url);
        if (!retry) throw error;
        await delay(backoff[index]);
      }
    }
  };
  return options.enqueue ? options.enqueue(attempt) : attempt();
}

function summarizeResult(json) {
  const items = asList(json);
  const tags = Array.isArray(json?.results?.tags) ? json.results.tags : [];
  const entries = items.length ? items : tags;
  return {
    count: entries.length,
    names: entries.slice(0, 3).map((item) => String(item?.name || item?.title || item?.entity_id || item?.id || "")).filter(Boolean),
  };
}

function requestTrace(url, requestMeta = {}) {
  const parsed = new URL(url);
  const split = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  const tags = Array.isArray(requestMeta.tags)
    ? requestMeta.tags
    : split(requestMeta.tags || parsed.searchParams.get("filter.tags"));
  const entity = requestMeta.entity
    || parsed.searchParams.get("signal.interests.entities")
    || parsed.searchParams.get("filter.results.entities")
    || parsed.searchParams.get("query")
    || parsed.searchParams.get("filter.query")
    || requestMeta.query
    || parsed.pathname;
  return { entity: String(entity), tags };
}

function recordRequest(options, result, url) {
  if (typeof options.onRequest !== "function") return;
  const trace = requestTrace(url, options.requestMeta);
  options.onRequest({
    ...options.requestMeta,
    ...trace,
    url,
    source: result.source,
    status: result.status,
    attempt: result.attempt,
    resultSummary: result.resultSummary ?? null,
  });
}

async function searchOne(item, options) {
  const typed = `${HACKATHON_BASE}/search?${new URLSearchParams({
    query: item.value,
    types: SEARCH_TYPES[item.key] || SEARCH_TYPES.work,
    take: "5",
  })}`;
  const requestMeta = { ...options.requestMeta, type: "search", query: item.value, entity: item.value, tags: [item.key] };
  let json = await qlooGet(typed, { ...options, requestMeta });
  if (!hasEntity(json)) {
    const plain = `${HACKATHON_BASE}/search?${new URLSearchParams({ query: item.value, take: "5" })}`;
    json = await qlooGet(plain, { ...options, requestMeta });
  }
  if (!hasEntity(json)) return null;
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
  if (cached?.music?.length && cached?.food?.length) return cached;
  const buckets = {
    music: { preferred: [], extra: [] },
    food: { preferred: [], extra: [] },
  };
  for (const query of TAG_QUERIES) {
    let json = null;
    try {
      json = await qlooGet(
        `${HACKATHON_BASE}/v2/tags?${new URLSearchParams({
          "filter.query": query.query,
          "filter.tag.types": query.types,
          take: "20",
        })}`,
        { ...options, requestMeta: { ...options.requestMeta, type: "tags", query: query.query, entity: query.query, tags: [query.query] } },
      );
    } catch (error) {
      if (error?.code === "RATE_LIMIT" || error?.code === "TIMEOUT") throw error;
      try {
        json = await qlooGet(
          `${HACKATHON_BASE}/v2/tags?${new URLSearchParams({
            "filter.query": query.query,
            take: "20",
          })}`,
          { ...options, requestMeta: { ...options.requestMeta, type: "tags", query: query.query, entity: query.query, tags: [query.query] } },
        );
      } catch (again) {
        if (again?.code === "RATE_LIMIT" || again?.code === "TIMEOUT") throw again;
      }
    }
    for (const tag of asTags(json)) {
      const id = acceptTag(tag);
      if (!id) continue;
      const name = normName(tag?.name || tag?.title);
      const lane = tagLane(name);
      if (!lane) continue;
      const bucket = TAG_NAMES.has(name) ? buckets[lane].preferred : buckets[lane].extra;
      bucket.push(id);
    }
  }
  const takeLane = (lane) => [...new Set([...buckets[lane].preferred, ...buckets[lane].extra])].slice(0, 6);
  const groups = { music: takeLane("music"), food: takeLane("food") };
  if (groups.music.length && groups.food.length) cache.set(TAG_CACHE_KEY, groups);
  return groups;
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
  const location = memberLocation(parsed, {});
  const cache = options.cache || defaultCache;
  const tagGroups = await lookupVenueTags(opts, cache);
  const tagIds = [...tagGroups.music, ...tagGroups.food];
  if (!tagGroups.music.length || !tagGroups.food.length) {
    const error = new Error("Qloo tag lookup returned no food or music venue tags");
    error.code = "DOWN";
    throw error;
  }
  const a = [];
  for (const item of parsed.a) {
    const found = await searchOne(item, opts);
    if (found) a.push(found);
  }
  const b = [];
  for (const item of parsed.b) {
    const found = await searchOne(item, opts);
    if (found) b.push(found);
  }
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
  const idsFor = (entries, kind) =>
    entries
      .filter((entry) => entry.kind === kind)
      .map((entry) => asList(entry.search)[0])
      .map((item) => item?.entity_id || item?.id)
      .filter(Boolean)
      .map(String);
  const musicSignal = idsFor([...a, ...b], "music");
  const foodSignal = idsFor([...a, ...b], "food");
  const discover = async (tags, signals) => {
    const json = await qlooGet(
      insightsUrl(
        placeParams({
          "signal.interests.entities": (signals.length ? signals : signalIds).join(","),
          "filter.tags": tags.join(","),
          "operator.filter.tags": "union",
          take: "8",
        }, location),
      ),
      opts,
    );
    return json;
  };
  const musicJson = await discover(tagGroups.music, musicSignal);
  const foodJson = await discover(tagGroups.food, foodSignal);
  const musicRaw = asList(musicJson);
  const foodRaw = asList(foodJson);
  const rawPlaces = [...musicRaw, ...foodRaw];
  const outsideCities = [
    ...new Set(rawPlaces.filter((item) => !isSameCityAt(item, location)).map((item) => cityOf(item)).filter(Boolean)),
  ];
  const venues = pickVenues(musicRaw, foodRaw, location);
  const signaled = localityOf(musicJson) || localityOf(foodJson);
  const localityMatches = signaled && (!location.city || normName(signaled.name).includes(normName(location.city)) || normName(location.city).includes(normName(signaled.name)));
  const locality = localityMatches
    ? signaled
    : venues.length
      ? { name: location.city || signaled?.name || "", id: signaled?.id || "" }
      : null;
  if (!venues.length) {
    const error = new Error(
      outsideCities.length
        ? `Qloo did not honor the city filter: ${outsideCities.join(", ")}`
        : "Qloo city filter returned no food or music venue",
    );
    error.code = "DOWN";
    throw error;
  }
  const scans = venues.map((item) => scanPlace(item));
  const placeIds = venues.map((item) => String(item.entity_id || item.id)).filter(Boolean);
  const scoreSide = async (ids) => {
    if (!ids.length || !placeIds.length) return new Map();
    try {
      const json = await qlooGet(
        insightsUrl(
          placeParams({
            "signal.interests.entities": ids.join(","),
            "filter.results.entities": placeIds.join(","),
            take: "8",
          }, location),
        ),
        opts,
      );
      return sideAffinities(json);
    } catch (error) {
      if (error?.code === "RATE_LIMIT" || error?.code === "TIMEOUT") throw error;
      return new Map();
    }
  };
  const [scoresA, scoresB] = [await scoreSide(aIds), await scoreSide(bIds)];
  const stamped = venues.map((item, index) => {
    const id = String(item.entity_id || item.id || "");
    const scan = scans[index];
    const next = { ...item };
    if (scoresA.has(id)) next.affinityA = scoresA.get(id);
    if (scoresB.has(id)) next.affinityB = scoresB.get(id);
    const city = cityOf(item);
    if (city) next.city = city;
    if (scan.lat != null && scan.lng != null) {
      next.lat = scan.lat;
      next.lng = scan.lng;
    }
    if (scan.address) next.address = scan.address;
    return next;
  });
  return interpret({
    a,
    b,
    insights: { results: { entities: stamped } },
    relationships,
    locality,
    venueTagIds: tagIds,
    placeCoverage: coverageOf(scans),
    locationFilter: {
      point: location.coordinates ? `POINT(${location.coordinates.lng} ${location.coordinates.lat})` : null,
      radiusM: location.coordinates?.radiusM || null,
      outsideCities,
      musicKept: venues.filter((item) => isMusicPlace(item)).length,
      foodKept: venues.filter((item) => !isMusicPlace(item)).length,
    },
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

function memberLocation(parsed, member) {
  const group = parsed?.context || {};
  const own = member?.context || member?.constraints || {};
  const coordinates = own.coordinates || group.coordinates || null;
  return {
    city: String(own.city || group.city || "").trim(),
    coordinates: coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)
      ? { lat: coordinates.lat, lng: coordinates.lng, radiusM: Number(coordinates.radiusM) > 0 ? coordinates.radiusM : 12000 }
      : null,
  };
}

function isSameCityAt(item, location) {
  const scan = scanPlace(item);
  if (location.coordinates && scan.lat != null && scan.lng != null) {
    return kmBetween(location.coordinates, scan) * 1000 <= location.coordinates.radiusM + 500;
  }
  const city = cityOf(item);
  if (!location.city || !city) return true;
  const expected = normName(location.city);
  const actual = normName(city);
  return actual.includes(expected) || expected.includes(actual);
}

function placeParamsAt(extra, location) {
  const params = { "filter.type": "urn:entity:place", ...extra };
  if (location.coordinates) {
    params["filter.location"] = `POINT(${location.coordinates.lng} ${location.coordinates.lat})`;
    params["filter.location.radius"] = String(location.coordinates.radiusM);
  }
  return params;
}

function pickVenuesAt(musicRaw, foodRaw, location) {
  const seen = new Set();
  const pull = (list, want, mode) => {
    const picked = [];
    for (const item of list) {
      if (picked.length >= want) break;
      const key = String(item?.entity_id || item?.id || item?.name || "");
      if (!key || seen.has(key) || !isVenue(item) || !isSameCityAt(item, location)) continue;
      const music = isMusicPlace(item);
      if (mode === "music" && !music) continue;
      if (mode === "food" && music) continue;
      seen.add(key);
      picked.push(item);
    }
    return picked;
  };
  const music = pull(musicRaw, 2, "music");
  const food = pull(foodRaw, 4 - music.length, "food");
  const extra = pull([...foodRaw, ...musicRaw], 4 - music.length - food.length, "any");
  return [...music, ...food, ...extra].slice(0, 4);
}

function memberEntity(entry) {
  const item = asList(entry.search)[0] || {};
  return {
    id: String(item.entity_id || item.id || ""),
    name: String(item.name || item.title || entry.query || ""),
    type: item.type || "",
    tags: tagList(item),
    kind: entry.kind,
    query: entry.query,
    sourceTag: "qloo:entity",
  };
}

function memberFallback(parsed, reason, warning, audit = {}) {
  const members = (parsed?.members || []).map((member) => ({
    id: member.id,
    name: member.name,
    context: member.context,
    entities: member.preferences.map((preference) => ({
      id: `mock:${member.id}:${preference.key}`,
      name: preference.value,
      kind: preference.key,
      query: preference.value,
      sourceTag: "mock:fixture",
    })),
    suggestions: [],
  }));
  return {
    source: "fallback",
    reason,
    fromQloo: false,
    warning,
    cached: false,
    members,
    suggestions: [],
    requestLog: audit.requestLog || [],
    requestStats: audit.requestStats || { total: 0, network: 0, retries: 0, rateLimited: 0, failed: 0, cacheHits: 0 },
    quota: audit.quota || { used: 0, limit: null, remaining: null },
  };
}

export async function resolveMembersHarness(parsed, options = {}) {
  const env = options.env || {};
  const apiKey = resolveApiKey(options.apiKey || env.QLOO_API_KEY);
  const timeoutMs = Number(options.timeoutMs || env.QLOO_TIMEOUT_MS || 8000);
  const cache = options.cache || new Map();
  const members = Array.isArray(parsed?.members) ? parsed.members : [];
  if (!members.length) throw new Error("members harness requires parsed members");
  if (!apiKey) return memberFallback(parsed, "missing_key", fallbackWarning("服务器没有密钥，没有调用 Qloo。成员结果标记 mock:fixture。"));

  const requestLog = [];
  const requestStats = { total: 0, network: 0, retries: 0, rateLimited: 0, failed: 0, cacheHits: 0 };
  const queue = createSerialQueue();
  const onRequest = (entry) => {
    requestStats.total += 1;
    if (entry.source === "cache") requestStats.cacheHits += 1;
    else {
      requestStats.network += 1;
      if (entry.attempt > 1) requestStats.retries += 1;
      if (entry.status === "RATE_LIMIT") requestStats.rateLimited += 1;
      if (entry.status !== "ok") requestStats.failed += 1;
    }
    requestLog.push({ ...entry, coordinates: entry.coordinates || null });
  };
  const baseOptions = {
    apiKey,
    timeoutMs,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    cache,
    enqueue: queue,
    requestCache: true,
    rateLimitBackoffMs: options.rateLimitBackoffMs,
    onRequest,
  };
  try {
  const tagGroups = await lookupVenueTags({ ...baseOptions, requestMeta: { memberId: "shared", city: parsed.context?.city || "", coordinates: parsed.context?.coordinates || null } }, cache);
  if (!tagGroups.music.length || !tagGroups.food.length) {
    const error = new Error("Qloo tag lookup returned no food or music venue tags");
    error.code = "DOWN";
    throw error;
  }
  const resolved = [];
  for (const member of members) {
    const location = memberLocation(parsed, member);
    const requestMeta = { memberId: member.id, city: location.city, coordinates: location.coordinates };
    const memberOptions = { ...baseOptions, requestMeta };
    const entries = [];
    for (const preference of member.preferences) {
      const found = await searchOne(preference, memberOptions);
      if (!found) throw new Error(`Qloo search returned no entity for ${preference.value}`);
      entries.push(found);
    }
    const ids = entries.map((entry) => asList(entry.search)[0]?.entity_id || asList(entry.search)[0]?.id).filter(Boolean).map(String);
    const discover = async (tags, query) => qlooGet(
      insightsUrl(placeParamsAt({
        "signal.interests.entities": ids.join(","),
        "filter.tags": tags.join(","),
        "operator.filter.tags": "union",
        take: "8",
      }, location)),
      { ...memberOptions, requestMeta: { ...requestMeta, type: "insights", query, entity: ids.join(","), tags } },
    );
    const musicJson = await discover(tagGroups.music, "music");
    const foodJson = await discover(tagGroups.food, "food");
    const venues = pickVenuesAt(asList(musicJson), asList(foodJson), location);
    const suggestions = venues.map((item) => {
      const scan = scanPlace(item);
      return {
        id: String(item.entity_id || item.id || ""),
        name: String(item.name || item.title || ""),
        type: item.type || "urn:entity:place",
        tags: tagList(item),
        city: cityOf(item) || location.city,
        ...(scan.lat != null && scan.lng != null ? { lat: scan.lat, lng: scan.lng } : {}),
        ...(scan.address ? { address: scan.address } : {}),
        memberScores: { [member.id]: typeof item?.query?.affinity === "number" ? item.query.affinity : null },
        sourceTag: "qloo:entity",
      };
    });
    resolved.push({
      id: member.id,
      name: member.name,
      context: member.context,
      entities: entries.map(memberEntity),
      suggestions,
      location,
    });
  }
  const limitRaw = options.quotaLimit ?? env.QLOO_QUOTA_LIMIT;
  const limit = Number(limitRaw);
  const suggestionMap = new Map();
  for (const member of resolved) {
    for (const suggestion of member.suggestions) {
      const current = suggestionMap.get(suggestion.id);
      suggestionMap.set(suggestion.id, {
        ...(current || suggestion),
        memberScores: { ...(current?.memberScores || {}), ...(suggestion.memberScores || {}) },
      });
    }
  }
  const suggestions = [...suggestionMap.values()];
  const fairness = scoreFairness({ members: parsed.members, context: parsed.context, candidates: suggestions });
  const routePlan = planRoute({ members: parsed.members, context: parsed.context, candidates: fairness.accepted });
  return {
    source: "live",
    reason: null,
    fromQloo: true,
    warning: "成员实体和候选地点来自 Qloo 响应。",
    cached: requestStats.cacheHits > 0 && requestStats.network === 0,
    members: resolved,
    suggestions,
    fairness,
    routePlan,
    requestLog,
    requestStats,
    quota: { used: requestStats.network, limit: Number.isFinite(limit) && limit > 0 ? limit : null, remaining: Number.isFinite(limit) && limit > 0 ? Math.max(0, limit - requestStats.network) : null },
  };
  } catch (error) {
    const reason = error?.code === "RATE_LIMIT" ? "rate_limit" : error?.code === "TIMEOUT" ? "timeout" : "down";
    const warning = fallbackWarning(
      reason === "rate_limit"
        ? "Qloo 限流。成员结果改用规则基线，来源标记 mock:fixture。"
        : reason === "timeout"
          ? "Qloo 超时。成员结果改用规则基线，来源标记 mock:fixture。"
          : `Qloo 不可用（${String(error?.message || "down").slice(0, 140)}）。成员结果改用规则基线，来源标记 mock:fixture。`,
    );
    const limitRaw = options.quotaLimit ?? env.QLOO_QUOTA_LIMIT;
    const limit = Number(limitRaw);
    const hasLimit = Number.isFinite(limit) && limit > 0;
    return memberFallback(parsed, reason, warning, {
      requestLog,
      requestStats,
      quota: { used: requestStats.network, limit: hasLimit ? limit : null, remaining: hasLimit ? Math.max(0, limit - requestStats.network) : null },
    });
  }
}

export function resolveApiKey(raw) {
  return String(raw || "").trim();
}

export async function handleQlooRequest(body, options = {}) {
  const env = options.env || {};
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const cache = options.cache || defaultCache;
  const apiKey = resolveApiKey(env.QLOO_API_KEY);
  const timeoutMs = Number(env.QLOO_TIMEOUT_MS || 8000);
  let parsed;
  try {
    parsed = parseTastes(body);
  } catch (error) {
    return { ok: false, reason: "bad_input", warning: error.message, insight: null };
  }
  if (!parsed.a || !parsed.b) {
    if (body?.mode === "members-harness" && parsed.members?.length > 2) {
      try {
        const insight = await resolveMembersHarness(parsed, { env, fetchImpl, cache, timeoutMs });
        return { ok: insight.source === "live" || insight.reason === "missing_key", reason: insight.reason, warning: insight.warning, insight };
      } catch (error) {
        const reason = error?.code === "RATE_LIMIT" ? "rate_limit" : error?.code === "TIMEOUT" ? "timeout" : "down";
        const warning = fallbackWarning(
          reason === "rate_limit"
            ? "Qloo 限流。成员结果改用规则基线，来源标记 mock:fixture。"
            : reason === "timeout"
              ? "Qloo 超时。成员结果改用规则基线，来源标记 mock:fixture。"
              : `Qloo 不可用（${String(error?.message || "down").slice(0, 140)}）。成员结果改用规则基线，来源标记 mock:fixture。`,
        );
        const insight = memberFallback(parsed, reason, warning);
        return { ok: false, reason, warning, insight };
      }
    }
    return { ok: false, reason: "group_not_supported", warning: "当前代理只运行双人路线；成员契约已完成解析。", insight: null };
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
            : `Qloo 不可用（${String(error?.message || "down").slice(0, 140)}）。页面改显示规则基线，来源标记 mock:fixture。`,
      );
      const insight = await withMock(parsed, reason, warning);
      payload = { ok: false, reason, warning, insight };
    }
  }

  const cacheable = payload.reason === "missing_key" || (payload.ok === true && payload.reason == null);
  if (cacheable) cache.set(cacheKey, payload);
  return payload;
}
