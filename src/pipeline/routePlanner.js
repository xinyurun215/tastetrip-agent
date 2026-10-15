function text(value) {
  return String(value ?? "").trim();
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = text(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function point(value) {
  const source = value && typeof value === "object" ? value : {};
  const nested = source.coordinates ?? source.coordinate ?? source.location ?? {};
  const lat = number(source.lat ?? source.latitude ?? nested.lat ?? nested.latitude);
  const lng = number(source.lng ?? source.lon ?? source.longitude ?? nested.lng ?? nested.longitude);
  return lat == null || lng == null ? null : { lat, lng };
}

function minutes(value) {
  const match = text(value).match(/(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : null;
}

function windowOf(value) {
  if (!value) return null;
  if (typeof value === "object") {
    const open = minutes(value.open ?? value.opens ?? value.start ?? value.from);
    const close = minutes(value.close ?? value.closes ?? value.end ?? value.to);
    return open == null || close == null ? null : { open, close };
  }
  const values = text(value).split(/\s*(?:-|–|—|至|到)\s*/).map(minutes);
  if (values.length < 2 || values.some((item) => item == null)) return null;
  return { open: values[0], close: values[1] };
}

function contextWindow(context) {
  const raw = context.timeWindow ?? context.time ?? context.hours;
  const parsed = windowOf(raw);
  if (parsed) return parsed;
  const open = minutes(context.startTime ?? context.start);
  const close = minutes(context.endTime ?? context.end);
  return open == null || close == null ? null : { open, close };
}

function candidateWindow(candidate) {
  return windowOf(candidate.timeWindow ?? candidate.openingHours ?? candidate.openHours ?? candidate.businessHours ?? candidate.hours ?? {
    open: candidate.openAt ?? candidate.opens ?? candidate.open,
    close: candidate.closeAt ?? candidate.closes ?? candidate.close,
  });
}

function costOf(candidate) {
  // Price levels and estimates are not actual amounts, and ranges are not exact prices.
  const raw = candidate.cost ?? candidate.price;
  const value = typeof raw === "number" ? finite(raw) : /^\d+(?:\.\d+)?$/.test(text(raw).replace(/,/g, "")) ? Number(text(raw).replace(/,/g, "")) : null;
  return value != null && value >= 0 ? value : null;
}

function durationOf(candidate) {
  const value = number(candidate.durationMinutes ?? candidate.duration ?? candidate.stayMinutes ?? candidate.dwellMinutes);
  return value != null && value >= 0 ? value : null;
}

function movementOf(candidate, previousId) {
  if (candidate.travelFromId != null && text(candidate.travelFromId) !== previousId) return null;
  const explicit = number(candidate.travelMinutes ?? candidate.travelTimeMinutes ?? candidate.travelTime);
  return explicit != null && explicit >= 0 ? Math.ceil(explicit) : null;
}

function idOf(candidate, index) {
  return text(candidate.id ?? candidate.candidateId ?? candidate.entity_id ?? candidate.placeId ?? candidate.name) || `candidate-${index + 1}`;
}

function nameOf(candidate, id) {
  return text(candidate.name ?? candidate.title) || id;
}

function haversine(left, right) {
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(right.lat - left.lat);
  const dLng = rad(right.lng - left.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function formatTime(value) {
  if (value == null) return null;
  const hour = Math.floor(value / 60) % 24;
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeInput(input) {
  const source = input && typeof input === "object" ? input : {};
  const fairness = source.fairness && typeof source.fairness === "object" ? source.fairness : {};
  return {
    members: Array.isArray(source.members) ? source.members : Array.isArray(fairness.members) ? fairness.members : [],
    context: source.context && typeof source.context === "object" ? source.context : {},
    candidates: Array.isArray(source.candidates)
      ? source.candidates
      : Array.isArray(source.fairnessCandidates)
        ? source.fairnessCandidates
        : Array.isArray(fairness.candidates)
          ? fairness.candidates
          : [],
  };
}

function memberScores(candidate, members) {
  const raw = candidate.scores ?? candidate.memberScores ?? {};
  return Object.fromEntries(members.map((member, index) => {
    const id = text(member?.id ?? member?.memberId ?? member?.name) || `member-${index + 1}`;
    const value = Array.isArray(raw) ? raw.find((item) => text(item?.memberId ?? item?.id) === id)?.score : raw[id];
    return [id, finite(value)];
  }));
}

function scoreReason(candidate, scores) {
  const details = Object.entries(scores).filter(([, value]) => value != null).map(([id, value]) => `${id} ${value.toFixed(2)}`);
  const fairness = finite(candidate.groupScore);
  return `成员评分 ${details.join("、") || "无"}${fairness == null ? "" : `；公平分 ${fairness.toFixed(2)}`}。`;
}

function orderCandidates(candidates, start) {
  const located = candidates.filter((item) => item.point);
  if (!start || !located.length) return [...candidates].sort((a, b) => (b.groupScore ?? -Infinity) - (a.groupScore ?? -Infinity));
  const rest = [...candidates];
  const ordered = [];
  let cursor = start;
  while (rest.length) {
    rest.sort((left, right) => {
      const leftDistance = left.point ? haversine(cursor, left.point) : Infinity;
      const rightDistance = right.point ? haversine(cursor, right.point) : Infinity;
      return leftDistance - rightDistance || (right.groupScore ?? -Infinity) - (left.groupScore ?? -Infinity);
    });
    const next = rest.shift();
    ordered.push(next);
    if (next.point) cursor = next.point;
  }
  return ordered;
}

/** Plan a multi-member route from fairness candidates under time, distance, and budget constraints. */
export function planRoute(input) {
  const { members, context, candidates: rawCandidates } = normalizeInput(input);
  const start = point(context);
  const candidates = rawCandidates.map((candidate, index) => ({ ...candidate, candidateId: idOf(candidate, index), point: point(candidate) }));
  const timeContexts = [context, ...members.map((member) => ({ ...member?.constraints, ...member?.context, ...member }))];
  const windows = timeContexts.map(contextWindow).filter(Boolean);
  const invalidTimeWindow = timeContexts.some((value) => (value.timeWindow || value.time || value.hours || value.startTime || value.endTime || value.end) && !contextWindow(value));
  const routeWindow = windows.length ? { open: Math.max(...windows.map((value) => value.open)), close: Math.min(...windows.map((value) => value.close)) } : null;
  const noCommonTime = Boolean(routeWindow && routeWindow.close <= routeWindow.open);
  const budgetLimit = number(context.budget) ?? Math.min(...members.map((member) => number(member?.budget ?? member?.constraints?.budget)).filter((value) => value != null));
  const hasBudget = Number.isFinite(budgetLimit);
  const locationMode = start && candidates.some((candidate) => candidate.point) ? "coordinates" : "unavailable";
  // Negotiation already ranks its selection; still recompute all feasibility checks.
  const ordered = input?.preserveOrder ? candidates : orderCandidates(candidates, start);
  const maxStops = Math.max(0, Math.floor(number(context.maxStops ?? context.maxSites ?? context.stopCount ?? context.siteCount) ?? ordered.length));
  let cursor = noCommonTime || invalidTimeWindow ? null : routeWindow?.open ?? null;
  let previous = start;
  let previousId = "start";
  let totalCost = 0;
  let knownCost = 0;
  let totalDistanceKm = 0;
  let totalTravelMinutes = 0;
  let timedOut = false;
  const stops = [];
  const evaluations = [];

  for (const candidate of ordered) {
    const scores = memberScores(candidate, members);
    const distanceKm = previous && candidate.point ? round(haversine(previous, candidate.point)) : null;
    const moveMinutes = movementOf(candidate, previousId);
    const cost = costOf(candidate);
    const knownDuration = durationOf(candidate);
    const duration = knownDuration ?? 60;
    const opening = candidateWindow(candidate);
    let arrival = cursor == null || moveMinutes == null ? null : cursor + moveMinutes;
    if (arrival != null && opening && arrival < opening.open) arrival = opening.open;
    const finish = arrival == null || !opening || knownDuration == null ? null : arrival + knownDuration;
    const withinTime = noCommonTime ? false : !routeWindow || invalidTimeWindow || finish == null ? null : finish <= routeWindow.close;
    const withinOpening = !opening || finish == null ? null : finish <= opening.close;
    const hardRejected = candidate.excluded === true || candidate.hardRejected === true || (candidate.filterReasons || []).some((reason) => reason?.type === "hard_rejection");
    const withinBudget = !hasBudget ? true : knownCost + (cost ?? 0) > budgetLimit ? false : totalCost == null || cost == null ? null : totalCost + cost <= budgetLimit;
    const canSelect = !hardRejected && withinTime !== false && withinOpening !== false && withinBudget !== false && stops.length < maxStops;
    if (withinTime === false || withinOpening === false) timedOut = true;
    const unknownFields = [
      ...(cost == null ? ["cost"] : []),
      ...(!opening ? ["openingHours"] : []),
      ...(moveMinutes == null ? ["travelMinutes"] : []),
      ...(knownDuration == null ? ["durationMinutes"] : []),
      ...(!routeWindow || invalidTimeWindow ? ["timeWindow"] : []),
      ...(finish == null ? ["schedule"] : []),
    ];
    const reasonCode = hardRejected ? "hard_rejected" : noCommonTime ? "no_common_time" : withinOpening === false ? "outside_opening" : withinTime === false ? "outside_time" : withinBudget === false ? "over_budget" : stops.length >= maxStops ? "stop_limit" : unknownFields.length ? "missing_facts" : "member_scores";
    const status = !canSelect ? "blocked" : unknownFields.length || withinBudget == null ? "needs_verification" : "verified";
    const feasibility = { hardRejected, withinTime, withinOpening, withinBudget, selected: canSelect };
    const evaluation = {
      candidateId: candidate.candidateId,
      id: candidate.candidateId,
      name: nameOf(candidate, candidate.candidateId),
      scores,
      memberScores: scores,
      sourceTag: candidate.sourceTag ?? candidate.source ?? null,
      source: candidate.sourceTag ?? candidate.source ?? null,
      distanceKm,
      moveMinutes,
      cost,
      arrival: formatTime(arrival),
      finish: formatTime(finish),
      feasibility,
      status,
      reasonCode,
      unknownFields,
      reason: hardRejected ? "成员硬拒绝，跳过。" : noCommonTime ? "成员没有共同可用时间，请调整时间。" : withinOpening === false ? "到达或停留时间超出营业时间。" : withinTime === false ? "超出行程时间窗。" : withinBudget === false ? "超出预算。" : stops.length >= maxStops ? "已达到站点上限。" : unknownFields.length ? "草案：费用、营业时间或路程等信息待核实。" : scoreReason(candidate, scores),
    };
    evaluations.push(evaluation);
    if (!canSelect) continue;

    knownCost += cost ?? 0;
    totalCost = totalCost == null || cost == null ? null : totalCost + cost;
    totalDistanceKm = totalDistanceKm == null || distanceKm == null ? null : totalDistanceKm + distanceKm;
    totalTravelMinutes = totalTravelMinutes == null || moveMinutes == null ? null : totalTravelMinutes + moveMinutes;
    cursor = finish;
    previous = candidate.point;
    previousId = candidate.candidateId;
    stops.push({
      candidateId: candidate.candidateId,
      id: candidate.candidateId,
      name: nameOf(candidate, candidate.candidateId),
      city: candidate.city || "",
      country: candidate.country || "",
      ...(candidate.point ? { lat: candidate.point.lat, lng: candidate.point.lng } : {}),
      ...(candidate.address ? { address: candidate.address } : {}),
      order: stops.length + 1,
      time: formatTime(arrival),
      finish: formatTime(finish),
      durationMinutes: duration,
      durationAssumed: knownDuration == null,
      distanceKm,
      moveMinutes,
      cost,
      scores,
      memberScores: scores,
      groupScore: finite(candidate.groupScore),
      reason: scoreReason(candidate, scores),
      sourceTag: candidate.sourceTag ?? candidate.source ?? null,
      source: candidate.sourceTag ?? candidate.source ?? null,
      feasibility,
      status,
      reasonCode,
      unknownFields,
    });
  }

  const withinBudget = !hasBudget ? true : totalCost == null ? null : totalCost <= budgetLimit;
  const withinTime = noCommonTime ? false : !routeWindow || invalidTimeWindow || cursor == null ? null : cursor <= routeWindow.close;
  const unknownFields = [...new Set(stops.flatMap((stop) => stop.unknownFields))];
  const feasible = stops.length > 0 && !unknownFields.length && withinBudget === true && withinTime === true;
  const status = noCommonTime || !stops.length ? "blocked" : feasible ? "verified" : "needs_verification";
  const reasonCode = noCommonTime ? "no_common_time" : !stops.length ? "no_feasible_stops" : feasible ? "verified" : "missing_facts";
  return {
    stops,
    evaluations,
    feasible,
    status,
    reasonCode,
    unknownFields,
    feasibility: { withinBudget, withinTime, timedOut, selectedStops: stops.length },
    timedOut,
    locationMode,
    distanceKind: "straight_line",
    reason: input?.preserveOrder
      ? "保留协商顺序，重新检查时间、预算和移动耗时。"
      : locationMode === "unavailable" ? "候选没有可用坐标，按公平分排序，移动时间降级为未知。" : "按起点和候选坐标估算移动顺序。",
    totalCost: totalCost == null ? null : round(totalCost),
    totalDistanceKm: totalDistanceKm == null ? null : round(totalDistanceKm),
    totalTravelMinutes,
    budget: { limit: hasBudget ? budgetLimit : null, total: totalCost == null ? null : round(totalCost), remaining: hasBudget && totalCost != null ? round(budgetLimit - totalCost) : null, within: withinBudget },
    time: { start: formatTime(routeWindow?.open), end: formatTime(routeWindow?.close), finish: formatTime(cursor), within: withinTime },
    sourceTags: [...new Set(stops.map((stop) => stop.sourceTag).filter(Boolean))],
  };
}

export const planMultiMemberRoute = planRoute;
export const buildRoutePlan = planRoute;
