function idOf(value, index = 0) {
  return String(value?.id ?? value?.candidateId ?? value?.memberId ?? value?.name ?? `item-${index + 1}`);
}

function membersOf(input) {
  return Array.isArray(input?.members) ? input.members : [];
}

function scoreMap(candidate, members) {
  const raw = candidate?.memberScores ?? candidate?.scores ?? candidate?.affinities ?? {};
  const map = Array.isArray(raw)
    ? Object.fromEntries(raw.map((item) => [String(item?.memberId ?? item?.id ?? item?.member), item?.score]))
    : raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(members.map((member, index) => {
    const id = idOf(member, index);
    const value = map[id];
    return [id, typeof value === "number" && Number.isFinite(value) ? value : null];
  }));
}

function hardRejected(candidate) {
  return candidate?.excluded === true || candidate?.hardRejected === true || (candidate?.filterReasons || []).some((item) => item?.type === "hard_rejection");
}

function canonicalAction(action = {}) {
  const type = String(action.type ?? action.action ?? "").toLowerCase().replace(/[\s-]/g, "_");
  if (["reject_site", "rejectsite", "reject", "拒绝站点"].includes(type)) return { ...action, type: "reject_site" };
  if (["prioritize_member", "prioritizemember", "priority_member", "照顾成员"].includes(type)) return { ...action, type: "prioritize_member" };
  if (["shorten_route", "shortenroute", "shorten", "缩短路线"].includes(type)) return { ...action, type: "shorten_route" };
  return { ...action, type };
}

function memberSatisfaction(selected, members) {
  return Object.fromEntries(members.map((member, index) => {
    const id = idOf(member, index);
    const values = selected.map((candidate) => scoreMap(candidate, members)[id]).filter((value) => value != null);
    return [id, values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null];
  }));
}

function lowestMember(satisfaction, members) {
  return members
    .map((member, index) => {
      const memberId = idOf(member, index);
      return { id: memberId, value: satisfaction[memberId] };
    })
    .sort((left, right) => (left.value == null ? -1 : left.value) - (right.value == null ? -1 : right.value))[0]?.id ?? null;
}

function weightedScore(candidate, members, weights) {
  const scores = scoreMap(candidate, members);
  let total = 0;
  let weight = 0;
  for (const member of members) {
    const id = idOf(member);
    if (scores[id] == null) continue;
    const factor = weights[id] ?? 1;
    total += scores[id] * factor;
    weight += factor;
  }
  return weight ? total / weight : -Infinity;
}

function rank(candidates, members, weights) {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: weightedScore(candidate, members, weights) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.candidate);
}

function statusOf(selected, candidates, members) {
  if (!selected.length) return "blocked";
  const missing = selected.some((candidate) => Object.values(scoreMap(candidate, members)).some((value) => value == null));
  const blocked = candidates.some(hardRejected);
  return missing || blocked ? "partial" : "achieved";
}

function snapshot(state, selected, remaining, status = state.status) {
  return {
    ...state,
    selected,
    selectedIds: selected.map((item) => idOf(item)),
    remaining,
    remainingIds: remaining.map((item) => idOf(item)),
    route: [...selected],
    status,
  };
}

/** Start a deterministic multi-member negotiation state (协商状态机). */
export function startNegotiation(input = {}) {
  const members = membersOf(input);
  const raw = Array.isArray(input.candidates) ? input.candidates : Array.isArray(input.route) ? input.route : [];
  const candidates = raw.map((candidate, index) => ({ ...candidate, id: idOf(candidate, index), sourceTag: candidate?.sourceTag ?? candidate?.source ?? null }));
  const rejectedIds = new Set(candidates.filter(hardRejected).map((candidate) => idOf(candidate)));
  const available = candidates.filter((candidate) => !rejectedIds.has(idOf(candidate)));
  const weights = Object.fromEntries(members.map((member, index) => [idOf(member, index), 1]));
  const limit = Math.max(0, Math.floor(input.maxStops ?? input.routeLimit ?? available.length));
  const selected = rank(available, members, weights).slice(0, limit);
  const remaining = available.filter((candidate) => !selected.includes(candidate));
  const base = {
    members: members.map((member, index) => ({ ...member, id: idOf(member, index) })),
    candidates,
    weights,
    routeLimit: limit,
    initialRouteLimit: limit,
    rejectedIds: [...rejectedIds],
    round: 0,
    trace: [],
    satisfaction: memberSatisfaction(selected, members),
  };
  return snapshot(base, selected, remaining, statusOf(selected, candidates, members));
}

/** Apply one action with local filtering/reordering and return a new state. */
export function applyNegotiationAction(previous, rawAction = {}) {
  const state = previous?.candidates ? previous : startNegotiation(previous);
  const action = canonicalAction(rawAction);
  if (action.type === "undo") {
    if (!state.trace.length) return state;
    const initial = startNegotiation({ members: state.members, candidates: state.candidates, maxStops: state.initialRouteLimit });
    return state.trace.slice(0, -1).reduce((current, entry) => applyNegotiationAction(current, entry.action), initial);
  }
  const members = state.members;
  const candidates = state.candidates;
  const rejected = new Set(state.rejectedIds || []);
  let limit = state.routeLimit;
  let selected = [...state.selected];
  let gained = { candidateId: null, memberId: null };
  let conceded = { candidateId: null, memberId: null };

  if (action.type === "reject_site") {
    const candidateId = String(action.candidateId ?? action.siteId ?? action.id ?? "");
    rejected.add(candidateId);
    const removed = selected.find((candidate) => idOf(candidate) === candidateId);
    if (removed) {
      selected = selected.filter((candidate) => idOf(candidate) !== candidateId);
      conceded = { candidateId, memberId: null };
    }
  }

  const weights = { ...state.weights };
  const beforeSatisfaction = memberSatisfaction(selected, members);
  const lowMember = lowestMember(beforeSatisfaction, members);
  if (lowMember) weights[lowMember] = (weights[lowMember] ?? 1) + 1;

  if (action.type === "prioritize_member") {
    const memberId = String(action.memberId ?? action.member ?? action.id ?? "");
    if (Object.hasOwn(weights, memberId)) weights[memberId] += 1;
    gained = { candidateId: null, memberId };
  }

  if (action.type === "shorten_route") {
    const count = Math.max(1, Number(action.count ?? action.by ?? 1));
    limit = Math.max(0, limit - count);
    selected = selected.slice(0, limit);
    conceded = { candidateId: selected.at(-1)?.id ?? null, memberId: null };
  }

  const available = candidates.filter((candidate) => !rejected.has(idOf(candidate)) && !hardRejected(candidate));
  const ranked = rank(available, members, weights);
  const selectedIds = new Set(selected.map((candidate) => idOf(candidate)));
  for (const candidate of ranked) {
    if (selected.length >= limit || selectedIds.has(idOf(candidate))) continue;
    selected.push(candidate);
    selectedIds.add(idOf(candidate));
    if (!gained.candidateId) gained = { candidateId: idOf(candidate), memberId: lowMember };
  }
  if (action.type === "prioritize_member") selected = rank(selected, members, weights);
  const remaining = ranked.filter((candidate) => !selectedIds.has(idOf(candidate)));
  const satisfaction = memberSatisfaction(selected, members);
  const status = statusOf(selected, candidates, members);
  const round = state.round + 1;
  const entry = {
    round,
    action,
    gained,
    gains: gained,
    conceded,
    concessions: conceded,
    selected: selected.map((candidate) => idOf(candidate)),
    remaining: remaining.map((candidate) => idOf(candidate)),
    weights: { ...weights },
    status,
  };
  return snapshot({ ...state, weights, routeLimit: limit, rejectedIds: [...rejected], round, trace: [...state.trace, entry], satisfaction }, selected, remaining, status);
}

export const negotiate = applyNegotiationAction;
