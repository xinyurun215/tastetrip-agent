const BASE = "https://hackathon.api.qloo.com";
const TYPES = { movie: "urn:entity:movie", artist: "urn:entity:artist", book: "urn:entity:book" };
const ID = /^[A-Za-z0-9:_-]{1,128}$/;
const text = (value) => typeof value === "string" ? value.trim() : "";
const idOf = (item) => text(item?.entity_id || item?.id);
const typesOf = (item) => [...new Set([...(Array.isArray(item?.types) ? item.types : []), item?.type, item?.subtype].filter((value) => typeof value === "string"))];
const urlFor = (path, params) => `${BASE}${path}?${new URLSearchParams(params)}`;
const errorWith = (code, message) => Object.assign(new Error(message), { code });

function parseInput(body) {
  if (!Array.isArray(body.members) || !body.members.length) throw errorWith("bad_input", "Add at least one member.");
  const seen = new Set();
  const search = body.mode === "common-search";
  const members = body.members.map((member) => {
    const id = text(member?.id);
    if (!ID.test(id) || seen.has(id)) throw errorWith("bad_input", "Member IDs must be valid and unique.");
    seen.add(id);
    const values = search ? member.preferences : member.entities;
    if (values != null && !Array.isArray(values)) throw errorWith("bad_input", "Preferences and confirmed entities must be lists.");
    const entries = (values || []).map((entry) => {
      if (!Object.hasOwn(TYPES, entry?.kind)) throw errorWith("bad_input", "Choose movie, artist or book.");
      if (search) {
        if (typeof entry.query !== "string") throw errorWith("bad_input", "Preference queries must be text.");
        const query = entry.query.trim();
        if (query.length > 200) throw errorWith("bad_input", "Preference queries must be 200 characters or fewer.");
        return { kind: entry.kind, query };
      }
      const entityId = text(entry.id);
      if (!ID.test(entityId)) throw errorWith("bad_input", "Confirm a valid entity ID before comparing.");
      return { id: entityId, kind: entry.kind };
    }).filter((entry) => !search || entry.query);
    return { id, name: text(member.name) || id, [search ? "preferences" : "entities"]: entries };
  });
  if (!members.some((member) => (search ? member.preferences : member.entities).length)) {
    throw errorWith("bad_input", "At least one member needs a preference signal.");
  }
  if (body.rejectedIds != null && (!Array.isArray(body.rejectedIds) || body.rejectedIds.some((id) => typeof id !== "string" || !ID.test(id.trim())))) {
    throw errorWith("bad_input", "Rejected places must be valid entity IDs.");
  }
  const rejectedIds = [...new Set((body.rejectedIds || []).map((id) => id.trim()))];
  if (rejectedIds.length > 100 || encodeURIComponent(rejectedIds.join(",")).length > 4096) {
    throw errorWith("bad_input", "Too many excluded places for one request.");
  }
  return { members, context: body.context || {}, rejectedIds };
}

function normalizeEntity(item, kind) {
  const properties = item.properties || {};
  const external = { ...(item.external || {}), ...(properties.external || {}) };
  const isbnSource = properties.isbn13 ?? item.isbn13 ?? external.isbn13 ?? [];
  const isbn13 = (Array.isArray(isbnSource) ? isbnSource : [isbnSource])
    .map((value) => typeof value === "object" ? value?.id || value?.value : value).filter(Boolean).map(String);
  return {
    id: idOf(item), name: text(item.name || item.title), kind, types: typesOf(item),
    disambiguation: text(item.disambiguation || properties.disambiguation),
    year: properties.release_year ?? properties.publication_year ?? properties.year ?? item.year ?? null,
    external, isbn13, sourceTag: "qloo:entity",
  };
}

function auditRequests() {
  const requestLog = [];
  const requestStats = { total: 0, network: 0, retries: 0, rateLimited: 0, failed: 0, cacheHits: 0 };
  return {
    requestLog, requestStats,
    onRequest(entry) {
      requestLog.push(entry);
      requestStats.total += 1;
      if (entry.source === "cache") requestStats.cacheHits += 1;
      else {
        requestStats.network += 1;
        if (entry.attempt > 1) requestStats.retries += 1;
        if (entry.status === "RATE_LIMIT") requestStats.rateLimited += 1;
        if (entry.status !== "ok") requestStats.failed += 1;
      }
    },
  };
}

export async function handleCommonCandidates(body, options, helpers) {
  const { asList, qlooGet, createSerialQueue, resolveDestination, placeParams, isSameCityAt, scanPlace, tagList, cityOf, countryOf } = helpers;
  const audit = auditRequests();
  let parsed;
  const unavailable = (reason, warning, extra = {}) => ({
    ok: false, reason, warning,
    insight: {
      mode: body.mode, source: "unavailable", fromQloo: false, reason, warning,
      members: (parsed?.members || []).map((member) => ({ id: member.id, name: member.name, entities: [], preferences: (member.preferences || []).map((preference) => ({ ...preference, matches: [] })) })),
      pool: [], rankings: [], requestLog: audit.requestLog, requestStats: audit.requestStats, ...extra,
    },
  });
  try {
    parsed = parseInput(body);
    if (!options.apiKey) return unavailable("missing_key", "Qloo is unavailable: no server credential is configured. No live lookup was run.");
    // Cache only within this operation so a later confirmation revalidates source facts.
    const requestOptions = { ...options, cache: new Map(), requestCache: true, emptyOnNotFound: true, enqueue: createSerialQueue(), onRequest: audit.onRequest };
    const get = (path, params, requestMeta) => qlooGet(urlFor(path, params), { ...requestOptions, requestMeta });
    if (body.mode === "common-search") {
      const members = [];
      for (const member of parsed.members) {
        const preferences = [];
        for (const preference of member.preferences) {
          const json = await get("/search", { query: preference.query, types: TYPES[preference.kind], take: "5", sort_by: "match" }, { memberId: member.id, type: "common-search", query: preference.query, tags: [preference.kind] });
          const seen = new Set();
          const matches = asList(json).filter((item) => {
            const id = idOf(item);
            if (!id || seen.has(id) || !typesOf(item).includes(TYPES[preference.kind])) return false;
            seen.add(id);
            return true;
          }).map((item) => normalizeEntity(item, preference.kind));
          preferences.push({ ...preference, matches });
        }
        members.push({ id: member.id, name: member.name, preferences });
      }
      return { ok: true, reason: null, insight: { mode: body.mode, source: "live", fromQloo: true, members, requestLog: audit.requestLog, requestStats: audit.requestStats } };
    }

    const signalIds = [...new Set(parsed.members.flatMap((member) => member.entities.map((entry) => entry.id)))];
    const details = [];
    // Small batches bound URL length without silently dropping any submitted signal.
    for (let index = 0; index < signalIds.length; index += 25) {
      const ids = signalIds.slice(index, index + 25);
      const json = await get("/entities", { entity_ids: ids.join(",") }, { memberId: "shared", type: "common-confirm", entity: ids.join(",") });
      details.push(...asList(json));
    }
    const members = parsed.members.map((member) => ({
      id: member.id, name: member.name,
      entities: member.entities.map((entry) => {
        const item = details.find((candidate) => idOf(candidate) === entry.id && typesOf(candidate).includes(TYPES[entry.kind]));
        if (!item) throw errorWith("entity_unverified", "A selected entity could not be verified in its declared category. Search and confirm it again.");
        return normalizeEntity(item, entry.kind);
      }),
    }));
    const destination = await resolveDestination(parsed, requestOptions);
    const sharedMeta = { memberId: "shared", city: destination.city, coordinates: destination.coordinates };
    const poolJson = await get("/v2/insights", placeParams({
      "signal.interests.entities": signalIds.join(","), take: "25", sort_by: "affinity",
      ...(parsed.rejectedIds.length ? { "filter.exclude.entities": parsed.rejectedIds.join(",") } : {}),
    }, destination), { ...sharedMeta, type: "common-pool" });
    const rejected = new Set(parsed.rejectedIds);
    const seen = new Set();
    const pool = asList(poolJson).filter((item) => {
      const id = idOf(item);
      if (!id || seen.has(id) || rejected.has(id) || !typesOf(item).includes("urn:entity:place") || !isSameCityAt(item, destination)) return false;
      seen.add(id);
      return true;
    }).slice(0, 25).map((item) => {
      const scan = scanPlace(item);
      return {
        id: idOf(item), name: text(item.name || item.title), type: "urn:entity:place", types: typesOf(item),
        lat: scan.lat, lng: scan.lng, location: { lat: scan.lat, lng: scan.lng }, address: scan.address,
        city: cityOf(item), country: countryOf(item), tags: tagList(item),
        external: { ...(item.external || {}), ...(item.properties?.external || {}) }, sourceTag: "qloo:entity",
      };
    });
    const poolIds = new Set(pool.map((item) => item.id));
    const rankings = [];
    for (const member of members) {
      if (!member.entities.length || !pool.length) {
        rankings.push({ memberId: member.id, entities: [], reason: member.entities.length ? "no_candidates" : "no_signal" });
        continue;
      }
      const json = await get("/v2/insights", placeParams({
        "signal.interests.entities": [...new Set(member.entities.map((entry) => entry.id))].join(","),
        "filter.results.entities": [...poolIds].join(","), "feature.explainability": "true", sort_by: "affinity", take: String(pool.length),
      }, destination), { ...sharedMeta, memberId: member.id, type: "common-ranking" });
      const rankedIds = new Set();
      const entities = asList(json).filter((item) => {
        const id = idOf(item);
        if (!poolIds.has(id) || rankedIds.has(id)) return false;
        rankedIds.add(id);
        return true;
      }).map((item) => ({ id: idOf(item), name: text(item.name || item.title), query: item.query || {} }));
      // Preserve Qloo order and omissions. Affinities from separate queries are not summed.
      rankings.push({ memberId: member.id, entities, warnings: json.warnings, queryWarning: json.query?.explainability?.warning });
    }
    const reason = pool.length ? null : "no_candidates";
    return { ok: true, reason, insight: { mode: body.mode, source: "live", fromQloo: true, reason, members, destination, pool, rankings, poolWarnings: poolJson.warnings, poolQueryWarning: poolJson.query?.explainability?.warning, requestLog: audit.requestLog, requestStats: audit.requestStats } };
  } catch (error) {
    const reason = error?.code === "RATE_LIMIT" ? "rate_limit" : error?.code === "TIMEOUT" ? "timeout" : error?.code === "DOWN" ? "down" : error?.code || "down";
    const known = ["bad_input", "entity_unverified"].includes(reason) || reason.startsWith("destination_");
    return unavailable(reason, known ? error.message : "Qloo could not complete this comparison. Retry when the service is available.", error.destinationCandidates ? { destinationCandidates: error.destinationCandidates } : {});
  }
}
