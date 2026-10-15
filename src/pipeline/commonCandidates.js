const text = value => String(value ?? '').trim();
const idOf = value => typeof value === 'string' ? value : text(value?.id ?? value?.entity_id ?? value?.entityId);
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

// Only a provider's identifier for a particular store proves equivalence.
// A shared name, street address, brand or Wikidata entry does not.
function storeKeys(candidate) {
  return [candidate.external, candidate.properties?.external].filter(Boolean).flatMap(external => {
    const values = external.google_places ?? external.googlePlaces ?? [];
    return (Array.isArray(values) ? values : [values]).flatMap(value => {
      const id = typeof value === 'string' ? text(value) : text(value?.id ?? value?.place_id);
      return id ? [`google_places:${id}`] : [];
    });
  });
}

export function sameCandidatePlace(left, right) {
  const leftIds = [idOf(left), ...(left.aliasIds || [])].filter(Boolean);
  const rightIds = [idOf(right), ...(right.aliasIds || [])].filter(Boolean);
  return leftIds.some(id => rightIds.includes(id)) || storeKeys(left).some(key => storeKeys(right).includes(key));
}

function uniquePool(pool) {
  const groups = [];
  for (const item of pool) {
    const id = idOf(item);
    if (!id) continue;
    const keys = storeKeys(item);
    const matches = groups.filter(group => group.ids.has(id) || keys.some(key => group.keys.has(key)));
    if (!matches.length) {
      groups.push({ candidate: { ...item, id }, ids: new Set([id]), keys: new Set(keys) });
      continue;
    }
    const first = matches[0];
    first.ids.add(id);
    keys.forEach(key => first.keys.add(key));
    // Preserve facts from the first record; later records can fill absent fields.
    first.candidate = { ...item, ...first.candidate };
    for (const group of matches.slice(1)) {
      group.ids.forEach(value => first.ids.add(value));
      group.keys.forEach(value => first.keys.add(value));
      groups.splice(groups.indexOf(group), 1);
    }
  }
  return groups.map(group => ({ ...group.candidate, aliasIds: [...group.ids] }));
}

function unavailableSignalsOf(signals, response) {
  const warnings = Array.isArray(response?.warnings) ? response.warnings : [];
  const missing = new Set(warnings.flatMap(warning => warning?.type === 'not_found'
    && Array.isArray(warning['signal.interests.entities']) ? warning['signal.interests.entities'] : []));
  return signals.map(idOf).filter(id => missing.has(id));
}

function evidenceOf(entity, returnedRank, signals, response, availability) {
  const explanation = entity?.query?.explainability;
  const raw = explanation?.['signal.interests.entities'];
  const contributions = (Array.isArray(raw) ? raw : [])
    .filter(item => finite(item?.score) != null && item.score >= 0 && item.score <= 1 && signals.some(signal => idOf(signal) === idOf(item)))
    .map(item => {
    const entityId = idOf(item);
    const name = signals.find(signal => idOf(signal) === entityId)?.name;
    return { entityId, ...(name ? { name } : {}), score: finite(item.score) };
  });
  return {
    rank: availability.usable ? returnedRank : null,
    returnedRank,
    ...availability,
    usable: availability.usable && returnedRank != null,
    affinity: finite(entity?.query?.affinity),
    contributions,
    // Absence from explainability is a reporting gap, not proof of no influence.
    missingSignalIds: signals.map(idOf).filter(id => !contributions.some(item => item.entityId === id)),
    warning: explanation?.warning ?? null,
    warnings: response?.warnings ?? null,
    queryWarning: response?.queryWarning ?? null,
    explanationMissing: !contributions.length,
  };
}

/** Compare each member's Qloo order over one fixed pool; never combine affinities. */
export function buildCommonComparison({ members = [], pool = [], rankings = [], source = null } = {}) {
  const emptyMemberMap = () => Object.fromEntries(members.map(member => [text(member.id ?? member.memberId), null]));
  const candidates = uniquePool(pool).map(item => ({ ...item, sourceTag: item.sourceTag ?? source,
    memberRanks: emptyMemberMap(), memberEvidence: emptyMemberMap() }));
  const canonicalIds = new Map(candidates.flatMap(item => item.aliasIds.map(alias => [alias, item.id])));
  const coverage = emptyMemberMap();
  const incompleteMemberIds = [];
  const unrankedMemberIds = [];
  for (const member of members) {
    const memberId = text(member.id ?? member.memberId);
    const signals = [...new Map((member.entities || []).filter(item => idOf(item)).map(item => [idOf(item), item])).values()];
    const hasSignals = signals.length > 0;
    const returned = new Map();
    const response = rankings.find(item => text(item.memberId) === memberId);
    if (hasSignals) for (const entity of response?.entities || []) {
      const canonical = canonicalIds.get(idOf(entity));
      if (canonical && !returned.has(canonical)) returned.set(canonical, { entity, rank: returned.size + 1 });
    }
    // Missing contribution details alone say nothing about whether a signal was used.
    // An explicit not_found warning for every confirmed signal is different: the
    // returned order cannot serve as that member's taste ranking.
    const unavailableSignalIds = unavailableSignalsOf(signals, response);
    const allSignalsUnavailable = hasSignals && unavailableSignalIds.length === signals.length;
    const availability = { unavailableSignalIds, allSignalsUnavailable, usable: hasSignals && !allSignalsUnavailable && returned.size > 0 };
    const returnedComplete = hasSignals && candidates.length > 0 && returned.size === candidates.length;
    const complete = availability.usable && returnedComplete;
    coverage[memberId] = { returnedCount: returned.size, poolCount: candidates.length, complete, returnedComplete, hasSignals, ...availability,
      warnings: response?.warnings ?? null, queryWarning: response?.queryWarning ?? null };
    if (!hasSignals || allSignalsUnavailable) unrankedMemberIds.push(memberId);
    else if (!complete) incompleteMemberIds.push(memberId);
    for (const candidate of candidates) {
      const item = returned.get(candidate.id);
      candidate.memberRanks[memberId] = availability.usable ? item?.rank ?? null : null;
      candidate.memberEvidence[memberId] = evidenceOf(item?.entity, item?.rank ?? null, signals, response, availability);
    }
  }
  const names = new Map();
  for (const candidate of candidates) {
    const name = text(candidate.name).normalize('NFKC').toLocaleLowerCase();
    if (name) names.set(name, [...(names.get(name) || []), candidate]);
  }
  const possibleDuplicates = [...names.values()].filter(group => group.length > 1).map(group => ({
    candidateIds: group.map(item => item.id), name: group[0].name, reason: 'same_name',
  }));
  const commonTop5Ids = members.length && !incompleteMemberIds.length && !unrankedMemberIds.length
    ? candidates.filter(item => members.every(member => {
      const rank = item.memberRanks[text(member.id ?? member.memberId)];
      return rank != null && rank <= 5;
    })).map(item => item.id) : [];
  return { members, candidates, coverage, commonTop5Ids, incompleteMemberIds, unrankedMemberIds, possibleDuplicates, source };
}
