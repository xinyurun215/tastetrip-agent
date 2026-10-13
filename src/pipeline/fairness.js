function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function text(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return text(value).toLowerCase().replace(/\s+/g, "");
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

function candidateId(candidate, index) {
  return text(candidate?.id ?? candidate?.entity_id ?? candidate?.placeId ?? candidate?.name) || `candidate-${index + 1}`;
}

function memberId(member, index) {
  return text(member?.id ?? member?.memberId ?? member?.name) || `member-${index + 1}`;
}

function sourceTag(candidate) {
  return candidate?.sourceTag ?? candidate?.source ?? null;
}

function scoreValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["score", "affinity", "value"]) {
    if (typeof value[key] === "number" && Number.isFinite(value[key])) return value[key];
  }
  return null;
}

function scoreMap(candidate, members) {
  const map = {};
  const raw = candidate?.memberScores ?? candidate?.scores ?? candidate?.affinities;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const id = text(item?.memberId ?? item?.member_id ?? item?.id ?? item?.member);
      if (id) map[id] = scoreValue(item);
    }
  } else if (raw && typeof raw === "object") {
    for (const [id, value] of Object.entries(raw)) map[id] = scoreValue(value);
  }
  if (members.length === 2) {
    const ids = members.map((member, index) => memberId(member, index));
    if (!(ids[0] in map)) map[ids[0]] = scoreValue(candidate?.affinityA);
    if (!(ids[1] in map)) map[ids[1]] = scoreValue(candidate?.affinityB);
  }
  return Object.fromEntries(members.map((member, index) => {
    const id = memberId(member, index);
    return [id, Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null];
  }));
}

function candidateText(candidate) {
  const values = [
    candidate?.name,
    candidate?.title,
    candidate?.type,
    candidate?.description,
    candidate?.category,
    candidate?.cuisine,
    ...asArray(candidate?.tags).map((tag) => (tag && typeof tag === "object" ? tag.name ?? tag.title ?? tag.id : tag)),
    ...asArray(candidate?.keywords),
    ...asArray(candidate?.attributes),
  ];
  return values.map(text).filter(Boolean);
}

function rejectionReasons(candidate, members, context) {
  const reasons = [];
  const people = [
    ...members.map((member, index) => ({ member, memberId: memberId(member, index) })),
    ...(context ? [{ member: context, memberId: "group" }] : []),
  ];
  const values = candidateText(candidate);
  const normalizedValues = values.map(normalize).filter(Boolean);
  for (const { member, memberId: id } of people) {
    const rejects = [
      ...asArray(member?.hardRejections),
      ...asArray(member?.context?.hardRejections),
      ...asArray(member?.constraints?.hardRejections),
    ].map(text).filter(Boolean);
    for (const rejection of rejects) {
      const needle = normalize(rejection);
      const matched = values.filter((value) => normalize(value).includes(needle));
      if (needle && normalizedValues.some((value) => value.includes(needle))) {
        reasons.push({ type: "hard_rejection", memberId: id, rejection, matched: [...new Set(matched)] });
      }
    }
  }
  return reasons;
}

function normalizeInput(input, maybeCandidates) {
  if (Array.isArray(input)) {
    return { members: input, candidates: Array.isArray(maybeCandidates) ? maybeCandidates : maybeCandidates?.candidates || [] };
  }
  const source = input && typeof input === "object" ? input : {};
  return {
    members: Array.isArray(source.members) ? source.members : [],
    candidates: Array.isArray(source.candidates) ? source.candidates : Array.isArray(source.suggestions) ? source.suggestions : [],
    context: source.context,
  };
}

/** Score each candidate for every member without inventing missing affinity values. */
export function scoreFairness(input, maybeCandidates) {
  const { members, candidates, context } = normalizeInput(input, maybeCandidates);
  const rows = [];
  const scored = candidates.map((candidate, index) => {
    const id = candidateId(candidate, index);
    const scores = scoreMap(candidate, members);
    const known = Object.values(scores).filter((value) => typeof value === "number");
    const averageSatisfaction = known.length ? round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
    const minimumSatisfaction = known.length ? round(Math.min(...known)) : null;
    const disagreement = known.length > 1 ? round(Math.max(...known) - Math.min(...known)) : 0;
    const reasons = rejectionReasons(candidate, members, context);
    const groupScore = averageSatisfaction == null || minimumSatisfaction == null
      ? null
      : round(averageSatisfaction + minimumSatisfaction - disagreement);
    const row = {
      candidateId: id,
      candidateName: text(candidate?.name ?? candidate?.title) || id,
      sourceTag: sourceTag(candidate),
      scores,
      averageSatisfaction,
      minimumSatisfaction,
      disagreement,
      groupScore,
      scoreCoverage: members.length ? known.length / members.length : 0,
    };
    rows.push(row);
    return {
      ...candidate,
      id: candidate?.id ?? candidate?.entity_id ?? id,
      sourceTag: sourceTag(candidate),
      scores,
      averageSatisfaction,
      minimumSatisfaction,
      disagreement,
      scoreCoverage: row.scoreCoverage,
      groupScore,
      excluded: reasons.length > 0,
      filterReasons: reasons,
    };
  });
  return {
    members: members.map((member, index) => ({ id: memberId(member, index), name: text(member?.name) || memberId(member, index) })),
    scoreMatrix: rows,
    matrixByCandidate: Object.fromEntries(rows.map((row) => [row.candidateId, row.scores])),
    candidates: scored,
    accepted: scored.filter((candidate) => !candidate.excluded),
    filtered: scored.filter((candidate) => candidate.excluded),
  };
}

export const scoreGroupFairness = scoreFairness;
export const scoreCandidates = scoreFairness;


