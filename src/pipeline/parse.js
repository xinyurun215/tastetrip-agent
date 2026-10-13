export const KINDS = [
  { key: "work", label: "作品" },
  { key: "music", label: "音乐" },
  { key: "food", label: "饮食" },
];

function inputError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(text).filter(Boolean);
}

function coordinates(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const nested = source.coordinates ?? source.coordinate ?? source.location ?? source.startCoordinates ?? {};
  const lat = Number(source.lat ?? source.latitude ?? nested.lat ?? nested.latitude);
  const lng = Number(source.lng ?? source.lon ?? source.longitude ?? nested.lng ?? nested.lon ?? nested.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const radiusM = Number(source.radiusM ?? source.radius ?? nested.radiusM ?? nested.radius);
  return { lat, lng, ...(Number.isFinite(radiusM) && radiusM > 0 ? { radiusM } : {}) };
}

function preferenceValues(raw) {
  if (Array.isArray(raw)) return raw.map(text);
  if (!raw || typeof raw !== "object") return [];
  return KINDS.map((kind) => raw[kind.key] ?? raw[kind.label] ?? "").map(text);
}

function pack(values) {
  return KINDS.map((kind, index) => ({ ...kind, value: values[index] }));
}

function parseContext(raw) {
  const context = raw && typeof raw === "object" ? raw : {};
  const city = text(context.city ?? context.destination);
  const start = text(context.start ?? context.startPoint ?? context.origin);
  const time = text(context.time ?? context.timeWindow);
  const budget = context.budget == null || text(context.budget) === "" ? null : typeof context.budget === "string" ? text(context.budget) : context.budget;
  const hardRejections = list(context.hardRejections ?? context.hard_rejections ?? context.hardRejects ?? context.hard);
  const softPreferences = list(context.softPreferences ?? context.soft_preferences ?? context.softPreference ?? context.soft);
  const parsedCoordinates = coordinates(context);
  return {
    city,
    start,
    time,
    budget,
    hardRejections,
    softPreferences,
    ...(parsedCoordinates ? { coordinates: parsedCoordinates } : {}),
  };
}

function parseMemberContext(source) {
  const nested = source.context ?? source.constraints ?? {};
  return parseContext({
    ...nested,
    coordinates: source.coordinates ?? source.coordinate ?? source.location ?? nested.coordinates ?? nested.coordinate ?? nested.location,
    city: source.city ?? nested.city,
    start: source.start ?? source.startPoint ?? nested.start ?? nested.startPoint,
    time: source.time ?? source.timeWindow ?? nested.time ?? nested.timeWindow,
    budget: source.budget ?? nested.budget,
    hardRejections: source.hardRejections ?? source.hard_rejections ?? source.hardRejects ?? source.hardReject ?? nested.hardRejections ?? nested.hard_rejections,
    softPreferences: source.softPreferences ?? source.soft_preferences ?? source.softPreference ?? nested.softPreferences ?? nested.soft_preferences,
  });
}

function parseMembers(raw) {
  const hasMembers = Boolean(raw && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, "members"));
  if (!hasMembers) return null;
  const members = Array.isArray(raw.members) ? raw.members : [];
  if (members.length === 0) throw inputError("EMPTY_MEMBERS", "至少需要一名成员才能继续。");

  const seen = new Set();
  return members.map((member, index) => {
    const source = member && typeof member === "object" ? member : {};
    const id = text(source.id ?? source.memberId ?? source.name) || `member-${index + 1}`;
    const name = text(source.name) || id;
    const values = preferenceValues(source.preferences ?? source.tastes ?? source.preference);
    if (values.length !== KINDS.length || values.some((value) => value.length === 0)) {
      throw inputError("MISSING_PREFERENCES", `成员「${name}」缺少完整偏好。`);
    }
    if (seen.has(id)) throw inputError("DUPLICATE_MEMBER", `成员「${id}」重复。`);
    seen.add(id);
    const context = parseMemberContext(source);
    return {
      id,
      name,
      tastes: values,
      preferences: pack(values),
      context,
      constraints: context,
      hardRejections: context.hardRejections,
      softPreferences: context.softPreferences,
    };
  });
}

export function parseTastes(raw) {
  const parsedMembers = parseMembers(raw);
  if (parsedMembers) {
    const result = { members: parsedMembers, context: parseContext(raw?.context) };
    if (parsedMembers.length === 2) {
      result.a = parsedMembers[0].preferences;
      result.b = parsedMembers[1].preferences;
    }
    return result;
  }

  const a = [0, 1, 2].map((index) => String(raw?.a?.[index] ?? "").trim());
  const b = [0, 1, 2].map((index) => String(raw?.b?.[index] ?? "").trim());
  if ([...a, ...b].some((value) => value.length === 0)) {
    throw inputError("INCOMPLETE", "六项口味都填上之后，才能撕开票根并重排。");
  }
  const members = [
    { id: "a", name: "旅人 A", tastes: a, preferences: pack(a), context: parseContext(), constraints: parseContext(), hardRejections: [], softPreferences: [] },
    { id: "b", name: "旅人 B", tastes: b, preferences: pack(b), context: parseContext(), constraints: parseContext(), hardRejections: [], softPreferences: [] },
  ];
  return { a: members[0].preferences, b: members[1].preferences, members, context: parseContext(raw?.context) };
}
