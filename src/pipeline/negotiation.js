import { planRoute } from './routePlanner.js';
import { sameCandidatePlace } from './commonCandidates.js';

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

// The review flow deliberately separates adopted choices from a pending change.
// A version is invalidated on every user decision, including cancel and undo.
function rankValues(candidate, members) {
  return members.map(member => candidate.memberRanks?.[idOf(member)])
    .filter(value => Number.isInteger(value) && value > 0);
}

function hasReviewEvidence(candidate, members, comparisonMode) {
  return comparisonMode ? members.length > 0 && rankValues(candidate, members).length === members.length
    : Object.values(scoreMap(candidate, members)).every(value => value != null);
}

function reviewRank(candidates, members, comparisonMode = false) {
  if (comparisonMode) return candidates.map((candidate, index) => {
    const ranks = rankValues(candidate, members);
    return { candidate, index, coverage: ranks.length, worst: Math.max(...ranks), total: ranks.reduce((sum, value) => sum + value, 0) };
  }).sort((a, b) => b.coverage - a.coverage || a.worst - b.worst || a.total - b.total || a.index - b.index)
    .map(item => item.candidate);
  return candidates.map((candidate, index) => {
    const values = Object.values(scoreMap(candidate, members)).filter(value => value != null);
    const score = values.length === members.length && values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length + Math.min(...values) - (Math.max(...values) - Math.min(...values))
      : -Infinity;
    return { candidate, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(item => item.candidate);
}

const ids = items => items.map(item => idOf(item));
function reviewRoute(state, candidates = state.selected) {
  const route = planRoute({ members: state.members, context: state.context, candidates, preserveOrder: true });
  if (!state.comparisonMode) return route;
  const preserveEvidence = item => {
    const candidate = candidates.find(candidate => idOf(candidate) === item.id);
    return { ...item, memberRanks: candidate?.memberRanks ?? {}, memberEvidence: candidate?.memberEvidence ?? {} };
  };
  return { ...route, comparisonMode: true, stops: route.stops.map(preserveEvidence), evaluations: route.evaluations.map(preserveEvidence) };
}

export function startReview({ members = [], context = {}, candidates = [], maxStops = 3,
  comparisonMode = candidates.some(item => item.memberRanks != null), initialSelection } = {}) {
  const available = candidates.filter(candidate => !hardRejected(candidate));
  const known = available.filter(item => hasReviewEvidence(item, members, comparisonMode));
  const selected = (Array.isArray(initialSelection)
    ? initialSelection.map(item => available.find(candidate => idOf(candidate) === (typeof item === 'string' ? item : idOf(item)))).filter(Boolean)
    : reviewRank(known, members, comparisonMode)).slice(0, maxStops);
  const state = { members, context, candidates: available, selected, base: selected, targetCount: selected.length, maxStops, comparisonMode,
    version: 1, rejectedIds: [], rejectedCandidates: candidates.filter(hardRejected), rejectedNames: {}, confirmedIds: [], confirmedVersion: null, pending: null, history: [], phase: 'draft', notice: null };
  const route = reviewRoute(state);
  // A known conflict may remove a draft stop. Unknown facts keep a clearly labelled draft.
  state.selected = selected.filter(candidate => route.stops.some(stop => stop.id === candidate.id));
  state.base = state.selected;
  state.targetCount = state.selected.length;
  if (!state.selected.length) state.phase = 'blocked';
  if (!known.length && available.length) state.notice = comparisonMode ? 'missing_ranks' : 'missing_scores';
  return state;
}

function remember(state) {
  const { history, ...previous } = state;
  return [...history, { ...previous, pending: null }];
}

function invalidateChangedLegs(before, selected) {
  return selected.map((item, index) => {
    const previousId = index ? idOf(selected[index - 1]) : 'start';
    const oldIndex = before.findIndex(stop => idOf(stop) === idOf(item));
    const oldPreviousId = oldIndex > 0 ? idOf(before[oldIndex - 1]) : 'start';
    if (oldIndex >= 0 && previousId === oldPreviousId) return item;
    const { travelMinutes, travelTimeMinutes, travelTime, ...unknownLeg } = item;
    return unknownLeg;
  });
}

export function rejectReview(state, candidateId, expectedVersion) {
  if (expectedVersion !== state.version || !state.selected.some(item => idOf(item) === candidateId)) return state;
  return { ...state, history: remember(state), version: state.version + 1,
    selected: invalidateChangedLegs(state.base, state.selected.filter(item => idOf(item) !== candidateId)),
    rejectedIds: [...new Set([...state.rejectedIds, candidateId])],
    rejectedCandidates: [...(state.rejectedCandidates || []), state.selected.find(item => idOf(item) === candidateId)],
    rejectedNames: { ...state.rejectedNames, [candidateId]: state.selected.find(item => idOf(item) === candidateId)?.name || candidateId },
    confirmedIds: state.confirmedIds.filter(id => id !== candidateId), confirmedVersion: null,
    pending: null, phase: 'checking', notice: null };
}

export function proposeReview(state, expectedVersion, additions = [], { queried = false, error = null } = {}) {
  if (expectedVersion !== state.version) return state;
  if (error) return { ...state, pending: null, phase: 'blocked', notice: error };
  const candidates = mergeReviewCandidates(state.candidates, additions)
    .filter(item => !hardRejected(item) && !isReviewRejected(state, item));
  // Rank positions only compare places from the same query's pool.
  const replacementPool = state.comparisonMode && (queried || additions.length)
    ? candidates.filter(item => additions.some(addition => sameCandidatePlace(addition, item))) : candidates;
  const pool = reviewRank(replacementPool.filter(item => !state.selected.some(stop => sameCandidatePlace(stop, item))), state.members, state.comparisonMode);
  const eligible = pool.filter(item => hasReviewEvidence(item, state.members, state.comparisonMode));
  const needed = state.targetCount - state.selected.length;
  if (eligible.length < needed) return { ...state, candidates, pending: null, phase: queried ? 'blocked' : 'checking',
    notice: queried ? (pool.length > eligible.length ? (state.comparisonMode ? 'missing_ranks' : 'missing_scores') : 'no_alternatives') : null };
  const replacements = eligible.slice(0, needed);
  const selected = state.base.flatMap(item => state.rejectedIds.includes(idOf(item)) ? (replacements.length ? [replacements.shift()] : []) : [state.selected.find(stop => idOf(stop) === idOf(item))]).filter(Boolean);
  return reviewProposal(state, candidates, selected, queried);
}

function isReviewRejected(state, candidate) {
  return state.rejectedIds.includes(idOf(candidate)) || (state.rejectedCandidates || []).some(item => sameCandidatePlace(item, candidate));
}

function mergeReviewCandidates(existing, additions) {
  const candidates = [...existing];
  for (const candidate of additions) {
    const index = candidates.findIndex(item => sameCandidatePlace(item, candidate));
    if (index < 0) candidates.push(candidate);
    else {
      const previous = candidates[index];
      candidates[index] = { ...candidate, id: idOf(previous),
        aliasIds: [...new Set([idOf(previous), ...(previous.aliasIds || []), idOf(candidate), ...(candidate.aliasIds || [])])] };
    }
  }
  return candidates;
}

function reviewProposal(state, candidates, selected, queried = false) {
  // Inbound travel facts belong to a leg, not just a place. Recheck changed legs.
  const changed = invalidateChangedLegs(state.base, selected);
  const route = reviewRoute(state, changed);
  const routeIds = ids(route.stops);
  if (state.confirmedIds.some(id => !routeIds.includes(id))) return { ...state, candidates, pending: null, phase: 'blocked', notice: 'confirmed_conflict' };
  if (route.stops.length !== changed.length) return { ...state, candidates, pending: null, phase: 'blocked', notice: 'constraints_conflict' };
  const beforeIds = ids(state.base);
  const afterIds = ids(changed);
  const changedIndex = beforeIds.findIndex((id, index) => id !== afterIds[index]);
  const firstChange = changedIndex < 0 ? beforeIds.length : changedIndex;
  const diff = { removed: beforeIds.filter(id => !afterIds.includes(id)), added: afterIds.filter(id => !beforeIds.includes(id)),
    retained: state.confirmedIds.slice(), affected: afterIds.slice(firstChange), before: reviewRoute(state, state.base), after: route };
  return { ...state, candidates, pending: { version: state.version, selected: changed, route, diff, queried }, phase: 'proposal', notice: null };
}

/** An operator choice creates a reviewable proposal; it is not a member vote. */
export function selectReviewCandidate(state, candidateId, expectedVersion) {
  if (expectedVersion !== state.version || state.rejectedIds.includes(candidateId)) return state;
  const candidate = state.candidates.find(item => (idOf(item) === candidateId || item.aliasIds?.includes(candidateId)) && !hardRejected(item));
  if (!candidate || isReviewRejected(state, candidate) || state.selected.some(item => sameCandidatePlace(item, candidate))) return state;
  const selected = [...state.selected];
  if (selected.length < state.maxStops) selected.push(candidate);
  else {
    const replaceIndex = selected.findIndex(item => !state.confirmedIds.includes(idOf(item)));
    if (replaceIndex < 0) return { ...state, pending: null, notice: 'confirmed_conflict' };
    selected[replaceIndex] = candidate;
  }
  // Invalidate any in-flight replacement request as soon as the operator chooses.
  return reviewProposal({ ...state, version: state.version + 1, confirmedVersion: null }, state.candidates, selected);
}

export function confirmReview(state, expectedVersion, candidateId = null) {
  if (expectedVersion !== state.version || ['checking', 'blocked', 'cancelled'].includes(state.phase)) return state;
  const selected = state.pending?.selected || state.selected;
  if (!selected.length || (candidateId && !selected.some(item => idOf(item) === candidateId))) return state;
  const version = state.version + 1;
  const confirmedIds = candidateId ? [...new Set([...state.confirmedIds, candidateId])] : ids(selected);
  return { ...state, history: remember(state), selected, base: selected, targetCount: Math.max(state.targetCount, selected.length), version,
    confirmedIds, confirmedVersion: confirmedIds.length === selected.length ? version : null,
    pending: null, phase: 'confirmed', notice: null };
}

export function cancelReview(state) {
  return { ...state, version: state.version + 1, pending: null, phase: 'cancelled', notice: 'cancelled', confirmedVersion: null };
}

export function undoReview(state) {
  if (!state.history.length) return state;
  const previous = state.history.at(-1);
  const version = state.version + 1;
  return { ...previous, version, history: state.history.slice(0, -1), pending: null,
    phase: previous.rejectedIds.length && previous.selected.length < previous.targetCount ? 'cancelled' : 'draft',
    confirmedVersion: previous.selected.length && previous.confirmedIds.length === previous.selected.length ? version : null };
}
