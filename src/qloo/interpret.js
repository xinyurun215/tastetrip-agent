function asList(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.results?.entities)) return json.results.entities;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.entities)) return json.entities;
  if (Array.isArray(json?.data)) return json.data;
  return [];
}

function affinityOf(item) {
  const value = item?.query?.affinity;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tagsOf(item) {
  if (!Array.isArray(item?.tags)) return [];
  return item.tags.map((tag) => (typeof tag === "string" ? tag : tag?.name)).filter(Boolean);
}

function firstItem(json) {
  return asList(json).find((item) => item && typeof item === "object" && (item.name || item.title || item.entity_id || item.id)) || null;
}

function toRecord(item, extra) {
  const affinity = affinityOf(item);
  const record = {
    id: String(item.entity_id || item.id || ""),
    name: String(item.name || item.title || extra.query || ""),
    type: item.type || "",
    tags: tagsOf(item),
    sourceTag: "qloo:entity",
    ...extra,
  };
  if (typeof item.popularity === "number") record.popularity = item.popularity;
  if (affinity != null) record.affinity = affinity;
  return record;
}

function relationshipIndex(json) {
  const byId = new Map();
  const byName = new Map();
  for (const item of asList(json)) {
    const affinity = affinityOf(item);
    if (affinity == null) continue;
    const id = item.entity_id || item.id;
    if (id) byId.set(String(id), affinity);
    if (item.name) byName.set(String(item.name), affinity);
  }
  return { byId, byName };
}

const DIMENSIONS = [
  { key: "work", label: "城市气质", labelEn: "City vibe" },
  { key: "music", label: "音乐场", labelEn: "Music room" },
  { key: "food", label: "用餐方式", labelEn: "Dining style" },
];

function norm(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

function tensionsFrom(entities, tag) {
  const tensions = [];
  for (const dimension of DIMENSIONS) {
    const a = entities.a.find((entity) => entity.kind === dimension.key);
    const b = entities.b.find((entity) => entity.kind === dimension.key);
    if (!a || !b) continue;
    if (norm(a.name) === norm(b.name)) continue;
    const aligned =
      typeof a.affinity === "number" &&
      typeof b.affinity === "number" &&
      a.affinity >= 0.5 &&
      b.affinity >= 0.5;
    if (aligned) continue;
    const bit = (entity) => (typeof entity.affinity === "number" ? ` · affinity ${entity.affinity.toFixed(2)}` : "");
    tensions.push({
      index: String(tensions.length + 1).padStart(2, "0"),
      label: dimension.label,
      labelEn: dimension.labelEn,
      sourceTag: tag,
      a: { title: a.name, detail: `${a.name}${bit(a)}`, sourceTag: tag },
      b: { title: b.name, detail: `${b.name}${bit(b)}`, sourceTag: tag },
    });
  }
  return tensions;
}

/**
 * Turn search JSON and insights JSON into the insight the pipeline reads.
 * Relationship affinities, when present, replace the search hit's own query affinity.
 * Scores are copied only when the payload has query.affinity. Nothing is invented.
 */
export function interpret(input, mode) {
  const tag = mode === "live" ? "qloo:entity" : "qloo:replay";
  const relations = relationshipIndex(input.relationships);
  const side = (entries) =>
    entries.map((entry) => {
      const item = firstItem(entry.search);
      if (!item) {
        const error = new Error(`Qloo search returned no entity for ${entry.query}`);
        error.code = "DOWN";
        throw error;
      }
      const entity = toRecord(item, { kind: entry.kind, query: entry.query });
      const related = relations.byId.get(entity.id) ?? relations.byName.get(entity.name);
      if (related != null) entity.affinity = related;
      return entity;
    });

  const entities = { a: side(input.a), b: side(input.b) };
  const suggestions = asList(input.insights)
    .map((item) => toRecord(item, {}))
    .filter((item) => item.name);

  const hasAffinity =
    [...entities.a, ...entities.b, ...suggestions].some((item) => typeof item.affinity === "number");

  let warning = null;
  if (mode === "replay") {
    warning = "没有服务器密钥。这次用录好的搜索和洞察回放。路线和冲突来自这些实体和亲和度，不是手写行程。";
  } else if (hasAffinity) {
    warning = "实体和亲和度来自 Qloo 响应。";
  } else {
    warning = "实体来自 Qloo。响应里没有亲和度，没有补分数。";
  }

  return {
    source: mode === "live" ? "live" : "replay",
    reason: null,
    fromQloo: true,
    warning,
    cached: false,
    entities,
    suggestions,
    tensions: tensionsFrom(entities, tag),
    overlap: {
      name: "夜城交叉",
      nameEn: "Night-city crossing",
      sourceTag: tag,
    },
  };
}
