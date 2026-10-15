import "./style.css";
import "./travelBook.css";
import { createTravelBook, openTravelBook } from "./travelBook.js";
import { DEMO_INPUT, FIELD_LABELS } from "./data.js";
import { detectConflicts } from "./pipeline/conflicts.js";
import { parseTastes } from "./pipeline/parse.js";
import { reorderRoute } from "./pipeline/reorder.js";
import { runPipeline } from "./pipeline/run.js";
import { createBrowserQlooClient } from "./qloo/browserClient.js";
import { createMockClient } from "./qloo/mock.js";
import { buildMembersRequest, scoreCell } from "./members.js";
import { scoreFairness } from "./pipeline/fairness.js";
import { planRoute } from "./pipeline/routePlanner.js";
import { applyNegotiationAction, startNegotiation } from "./pipeline/negotiation.js";

const app = document.querySelector("#app");

const TEAR_V =
  "M0 0 H12 L7 16 H16 L6 32 H14 L8 48 H17 L5 64 H15 L7 80 H16 L6 96 H14 L9 112 H18 L5 128 H15 L8 144 H16 L6 160 H14 L8 176 H17 L5 192 H15 L7 208 H16 L6 224 H14 L9 240 H17 L5 256 H15 L8 272 H16 L6 288 H14 L8 304 H16 L10 320 H0 Z";

const TEAR_H =
  "M0 0 H320 V12 L304 7 L288 16 L272 6 L256 14 L240 5 L224 15 L208 6 L192 16 L176 5 L160 14 L144 6 L128 16 L112 5 L96 15 L80 6 L64 16 L48 5 L32 14 L16 6 L0 12 Z";

const FALLBACK_TITLES = {
  missing_key: "没有密钥，这是规则基线",
  offline: "代理没连上，页面还在",
  rate_limit: "限流了，页面还在",
  timeout: "超时了，页面还在",
  down: "Qloo 不可用，页面还在",
};

const FAILURES = new Set(["missing_key", "offline", "rate_limit", "timeout", "down"]);

const DEFAULT_MEMBERS = [
  { id: "m1", name: "甲", preferences: ["电影", "爵士", "火锅"], city: "上海", start: "人民广场", time: "18:00-22:00", budget: "200", hardRejections: "海鲜", softPreferences: "现场音乐" },
  { id: "m2", name: "乙", preferences: ["展览", "摇滚", "烧烤"], city: "上海", start: "人民广场", time: "18:00-22:00", budget: "200", hardRejections: "", softPreferences: "" },
  { id: "m3", name: "丙", preferences: ["喜剧", "民谣", "面食"], city: "上海", start: "人民广场", time: "18:00-22:00", budget: "200", hardRejections: "", softPreferences: "" },
];

const DEFAULT_CONTEXT = {
  city: "上海",
  start: "人民广场",
  time: "18:00-22:00",
  budget: "500",
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tear(kind) {
  const path = kind === "h" ? TEAR_H : TEAR_V;
  const box = kind === "h" ? "0 0 320 20" : "0 0 20 320";
  return `<svg class="tear tear-${kind}" viewBox="${box}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/></svg>`;
}

function holes() {
  return `<span class="holes" aria-hidden="true">${"<i></i>".repeat(6)}</span>`;
}

function tag(value) {
  if (!value) return "";
  return `<span class="tag">${esc(value)}</span>`;
}

function renderMemberCard(member, index) {
  const preferences = Array.isArray(member.preferences) ? member.preferences : ["", "", ""];
  return `<article class="member-card" data-member-index="${index}">
    <div class="member-card-head"><h3>成员 ${index + 1}</h3><button type="button" class="member-remove" data-remove-member="${index}">删除</button></div>
    <label><span>称呼</span><input data-field="name" value="${esc(member.name)}" autocomplete="off" /></label>
    <div class="member-preferences">${FIELD_LABELS.map((label, preferenceIndex) => `<label><span>${esc(label)}</span><input class="member-preference" data-preference-index="${preferenceIndex}" value="${esc(preferences[preferenceIndex])}" autocomplete="off" /></label>`).join("")}</div>
    <div class="member-context">
      <label><span>城市</span><input data-field="city" value="${esc(member.city)}" placeholder="上海" autocomplete="off" /></label>
      <label><span>起点</span><input data-field="start" value="${esc(member.start)}" placeholder="人民广场" autocomplete="off" /></label>
      <label><span>时间</span><input data-field="time" value="${esc(member.time)}" placeholder="18:00-22:00" autocomplete="off" /></label>
      <label><span>预算</span><input data-field="budget" value="${esc(member.budget)}" inputmode="decimal" placeholder="200" autocomplete="off" /></label>
    </div>
    <div class="member-context member-constraints">
      <label><span>硬拒绝</span><input data-field="hardRejections" value="${esc(member.hardRejections)}" placeholder="海鲜" autocomplete="off" /></label>
      <label><span>软偏好</span><input data-field="softPreferences" value="${esc(member.softPreferences)}" placeholder="现场音乐" autocomplete="off" /></label>
    </div>
  </article>`;
}

function renderMembersWorkspace(members, context = DEFAULT_CONTEXT) {
  return `<form class="members-workspace" id="members-workspace">
    <div class="workspace-heading"><div><p class="seam-kicker">01 · Members · 多人</p><h2>把一群人的口味放上桌</h2><p>先锁定共同出行条件，再让每个人保留自己的偏好和硬拒绝。提交后进入 Qloo 结果页。</p></div><button type="submit" class="play">跑成员线束</button></div>
    <fieldset class="trip-context">
      <legend>共同出行条件 · Shared trip context</legend>
      <label><span>城市</span><input data-context="city" value="${esc(context.city)}" autocomplete="off" /></label>
      <label><span>起点</span><input data-context="start" value="${esc(context.start)}" autocomplete="off" /></label>
      <label><span>时间窗</span><input data-context="time" value="${esc(context.time)}" placeholder="18:00-22:00" autocomplete="off" /></label>
      <label><span>群组预算</span><input data-context="budget" value="${esc(context.budget)}" inputmode="decimal" placeholder="500" autocomplete="off" /></label>
    </fieldset>
    <div class="members-grid" id="members-list">${members.map(renderMemberCard).join("")}</div>
    <button type="button" class="ghost member-add" id="add-member">添加成员</button>
  </form>`;
}

function readMembersForm(form) {
  return [...form.querySelectorAll(".member-card")].map((card, index) => ({
    id: `m${index + 1}`,
    name: card.querySelector('[data-field="name"]')?.value || `成员 ${index + 1}`,
    preferences: [...card.querySelectorAll(".member-preference")].map((input) => input.value),
    city: card.querySelector('[data-field="city"]')?.value || "",
    start: card.querySelector('[data-field="start"]')?.value || "",
    time: card.querySelector('[data-field="time"]')?.value || "",
    budget: card.querySelector('[data-field="budget"]')?.value || "",
    hardRejections: card.querySelector('[data-field="hardRejections"]')?.value || "",
    softPreferences: card.querySelector('[data-field="softPreferences"]')?.value || "",
  }));
}

function readMembersContext(form) {
  return Object.fromEntries(
    ["city", "start", "time", "budget"].map((key) => [key, form.querySelector(`[data-context="${key}"]`)?.value || ""]),
  );
}

function matrixRows(result) {
  const direct = result?.scoreMatrix || result?.fairness?.scoreMatrix;
  if (Array.isArray(direct)) return direct;
  if (Array.isArray(result?.suggestions) && result.suggestions.length) return result.suggestions;
  return (result?.members || []).flatMap((member) => member.entities || []).map((entity) => ({ ...entity, candidateName: entity.name }));
}

function memberScore(row, member, index) {
  const scores = row?.scores || row?.memberScores || row?.affinities || {};
  const id = member.id || `m${index + 1}`;
  if (Array.isArray(scores)) {
    const found = scores.find((item) => item?.memberId === id || item?.id === id);
    return scoreCell(found?.score ?? found?.affinity);
  }
  return scoreCell(scores[id] ?? (index === 0 ? row?.affinityA : index === 1 ? row?.affinityB : null));
}

let membersNegotiationState = null;
const travelBooks = { members: null, pair: null };

function bookEntry(kind, count) {
  return count ? `<div class="book-entry"><button type="button" class="play" data-book-open="${kind}">打开回忆画册 ↗</button><p>摄影示例可体验 · 行程草稿尚未全员确认</p></div>` : "";
}

function planMembersNegotiation(result, request, existingNegotiation) {
  const parsed = parseTastes(request);
  const fairness = scoreFairness({ members: parsed.members, context: parsed.context, candidates: result.suggestions || [] });
  const negotiation = existingNegotiation ?? startNegotiation({ members: fairness.members, candidates: fairness.accepted, maxStops: fairness.accepted.length });
  const route = planRoute({
    members: parsed.members,
    context: parsed.context,
    candidates: negotiation.selected,
    preserveOrder: true,
  });
  const status = !route.feasible ? "blocked" : route.stops.length < negotiation.selected.length ? "partial" : negotiation.status;
  return { parsed, fairness, negotiation, route, status };
}

function renderMembersResult(result, request, existingNegotiation = null) {
  if (!result) return "";
  const members = result.members || [];
  let fairness = null;
  let route = null;
  let negotiation = existingNegotiation;
  let status = "blocked";
  try {
    ({ fairness, route, negotiation, status } = planMembersNegotiation(result, request, existingNegotiation));
  } catch {
    fairness = null;
  }
  if (!existingNegotiation && negotiation) membersNegotiationState = negotiation;
  const source = `${result.source === "live" ? "Qloo live · qloo:entity" : result.source === "unavailable" ? "目的地无法验证" : "Fallback · mock:fixture"}${result.warning ? ` · ${result.warning}` : ""}`;
  const entities = members.map((member) => `<article class="member-entity"><h3>${esc(member.name)} ${tag(member.sourceTag || (result.source === "live" ? "qloo:entity" : "mock:fixture"))}</h3><p>${(member.entities || []).map((entity) => `${esc(entity.name)} ${tag(entity.sourceTag || (result.source === "live" ? "qloo:entity" : "mock:fixture"))}`).join(" · ") || "—"}</p></article>`).join("");
  const rows = fairness?.scoreMatrix || matrixRows(result);
  const headers = members.map((member) => `<th scope="col">${esc(member.name || member.id)}</th>`).join("");
  const matrix = rows.length ? `<table class="score-matrix"><thead><tr><th scope="col">实体</th>${headers}<th scope="col">来源</th></tr></thead><tbody>${rows.map((row) => `<tr><th scope="row">${esc(row.candidateName || row.name || row.title || row.id || "实体")}</th>${members.map(memberScore.bind(null, row)).map((score) => `<td>${score}</td>`).join("")}<td>${esc(row.sourceTag || (result.source === "live" ? "qloo:entity" : "mock:fixture"))}</td></tr>`).join("")}</tbody></table>` : `<p class="empty-note">暂无评分矩阵，缺失亲和度显示为 —。</p>`;
  const rejectedRows = rows.filter((row) => row.excluded || row.filterReasons).map((row) => ({
    label: row.candidateName || row.name || row.title || "实体",
    sourceTag: row.filterReasons?.[0]?.type || "hard_rejection",
  }));
  const memberRejections = members.flatMap((member) => {
    const raw = member.hardRejections || member.context?.hardRejections || [];
    const rejects = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return rejects.map((rejection) => ({ label: `${member.name}：${rejection}`, sourceTag: "hard_rejection" }));
  });
  const conflicts = [...(result.conflicts || []), ...(fairness?.filtered || result.filtered || result.fairness?.filtered || []), ...rejectedRows, ...memberRejections];
  const conflictText = conflicts.length ? conflicts.map((item) => `<li>${esc(item.label || item.reason || item.candidateName || "硬拒绝")} ${tag(item.sourceTag || item.filterReasons?.[0]?.type || "hard_rejection")}</li>`).join("") : "<li>没有互相否决的成员约束。</li>";
  const routeSummary = route && negotiation ? `${route.stops.length} 站 · 协商第 ${negotiation.round} 轮 · ${status}` : "等待路线公平摘要；当前展示成员实体与来源。";
  const negotiationControls = negotiation ? `<div class="negotiation-panel"><h3>协商动作</h3><div class="negotiation-actions">${negotiation.selected.map((candidate) => `<button type="button" class="ghost" data-negotiate="reject_site" data-candidate-id="${esc(candidate.id)}">拒绝 ${esc(candidate.name || candidate.id)}</button>`).join("")}<button type="button" class="ghost" data-negotiate="prioritize_member" data-member-id="${esc(negotiation.members[0]?.id || "")}">更照顾 ${esc(negotiation.members[0]?.name || "成员 1")}</button><button type="button" class="ghost" data-negotiate="shorten_route" data-count="1">缩短一站</button>${negotiation.trace.length ? '<button type="button" class="ghost" data-negotiate="undo">撤回上轮</button>' : ""}</div><p class="negotiation-trace">${negotiation.trace.length ? negotiation.trace.map((entry) => `第 ${entry.round} 轮：${entry.action.type}；获得 ${entry.gained.candidateId || entry.gained.memberId || "—"}，让步 ${entry.conceded.candidateId || "—"}`).join(" · ") : "等待成员提出异议。"}</p></div>` : "";
  return `<section class="members-result reveal" id="members-result-panel"><div class="result-heading"><div><p class="seam-kicker">02 · Qloo result</p><h2>成员实体与公平线索</h2></div><p class="source-note">${esc(source)}</p></div><div class="member-entities">${entities}</div><h3>评分矩阵</h3>${matrix}${negotiationControls}<div class="members-summary"><section><h3>冲突 / 硬拒绝</h3><ul>${conflictText}</ul></section><section><h3>路线公平摘要</h3><p>${esc(routeSummary)}</p></section></div><button type="button" class="play shell-next" data-shell-next="negotiation">继续到协商路线 →</button></section>`;
}

function renderMembersNegotiation(result, request, negotiation = membersNegotiationState) {
  try {
    const { parsed, route } = planMembersNegotiation(result, request, negotiation);
    const stops = route.stops;
    travelBooks.members = createTravelBook({ route, context: request.context, members: parsed.members, candidates: result.suggestions || [], source: result.source });
    const list = stops.length
      ? stops
          .map(
            (stop, index) => `<li><span class="route-index">${String(index + 1).padStart(2, "0")}</span><div><b>${esc(stop.name)}</b><small>${esc(stop.time || "时间待定")} · ${esc(stop.reason || "成员公平分")}</small></div><em>${esc(stop.sourceTag || (result.source === "live" ? "qloo:entity" : "mock:fixture"))}</em></li>`,
          )
          .join("")
      : `<li class="route-empty">${esc(result.reason?.startsWith("destination_") || result.reason === "no_verified_places" ? result.warning : "暂无满足时间、预算和硬拒绝的站点。")}</li>`;
    const trace = negotiation?.trace?.length
      ? negotiation.trace.map((entry) => `第 ${entry.round} 轮 · ${entry.action.type} · 影响 ${entry.gained.candidateId || entry.gained.memberId || "局部路线"}`).join("；")
      : "等待成员提出第一条异议。";
    return `<section class="members-route reveal" id="members-route-panel"><div class="route-heading"><div><p class="seam-kicker">03 · Negotiation</p><h2>把公平结果排成可执行路线</h2></div><p class="source-note">${esc(result.source === "live" ? "Qloo candidates · qloo:entity" : result.source === "unavailable" ? "目的地未确认 · 无可用路线" : "Fallback candidates · mock:fixture")}</p></div><div class="route-summary"><p>${esc(parsed.context.city || "共同城市")} · ${esc(parsed.context.start || "起点待定")} · ${esc(parsed.context.time || "时间窗待定")}</p><p>第 ${negotiation?.round ?? 0} 轮 · ${esc(trace)}</p></div><ol class="members-route-list">${list}</ol>${bookEntry("members", stops.length)}<button type="button" class="ghost" data-shell-next="qloo">返回 Qloo 结果</button></section>`;
  } catch (error) {
    return `<section class="members-route reveal" id="members-route-panel"><div class="shell-empty"><p class="seam-kicker">03 · Negotiation</p><h2>路线暂时不能生成</h2><p>${esc(error?.message || "请回到 Qloo 结果检查缺失评分和硬拒绝。")}</p></div></section>`;
  }
}

function bindNegotiationPanel(result, request) {
  const panel = document.querySelector("#members-result-panel");
  if (!panel) return;
  panel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-negotiate]");
    if (!button || !membersNegotiationState) return;
    membersNegotiationState = applyNegotiationAction(membersNegotiationState, {
      type: button.dataset.negotiate,
      candidateId: button.dataset.candidateId,
      memberId: button.dataset.memberId,
      count: button.dataset.count,
    });
    panel.outerHTML = renderMembersResult(result, request, membersNegotiationState);
    const routeNode = document.querySelector("#members-route");
    if (routeNode) routeNode.innerHTML = renderMembersNegotiation(result, request, membersNegotiationState);
    bindNegotiationPanel(result, request);
    armReveal();
  });
}

function bars() {
  const widths = [2, 4, 2, 2, 6, 2, 4, 2, 2, 5, 2, 3, 2, 6, 2, 2, 4, 2];
  return `<p class="bars" aria-hidden="true">${widths.map((width) => `<i style="width:${width}px"></i>`).join("")}</p>`;
}

function tasteLines(tastes) {
  return `<ul class="tastes">${tastes
    .map((taste, index) => `<li><span>${esc(FIELD_LABELS[index])}</span>${esc(taste)}</li>`)
    .join("")}</ul>`;
}

function scorePair(stop) {
  if (!("affinityA" in stop) && !("affinityB" in stop)) return "";
  const a = typeof stop.affinityA === "number" ? stop.affinityA.toFixed(2) : "—";
  const b = typeof stop.affinityB === "number" ? stop.affinityB.toFixed(2) : "—";
  return `<p class="scores"><span>A ${esc(a)}</span><span>B ${esc(b)}</span></p>`;
}

function ticket(side, plan) {
  const who = side === "a" ? "A" : "B";
  const traveler = plan.travelers[side];
  const lines = plan.conflicts
    .map(
      (conflict) =>
        `<p><span>${esc(conflict.label)}</span> ${esc(conflict[side].title)} ${tag(conflict.sourceTag || conflict[side].sourceTag)}</p>`,
    )
    .join("");

  return `<article class="ticket ticket-${side}">
    ${holes()}
    <div class="ticket-body">
      <p class="stub-meta"><span>STUB ${who}</span><span>${esc(traveler.name)}</span></p>
      <p class="serial">NO. ${who === "A" ? "104281" : "104282"}</p>
      ${tasteLines(traveler.tastes)}
      <div class="ticket-clash">${lines}</div>
      ${bars()}
    </div>
    ${side === "a" ? tear("v") : ""}
    ${side === "b" ? tear("v") : ""}
    ${tear("h")}
  </article>`;
}

function renderEditor(input) {
  const fields = (side) =>
    FIELD_LABELS.map(
      (label, index) => `<label>
        <span>${esc(label)}</span>
        <input name="${side}-${index}" value="${esc(input[side][index])}" autocomplete="off" />
      </label>`,
    ).join("");

  return `<form class="editor reveal" id="retaste">
    <div class="editor-copy">
      <h2>改这组口味</h2>
      <p>一键试玩回到固定这一对。有服务器密钥就打 Qloo，没有就用规则基线，来源标记 mock:fixture。</p>
    </div>
    <div class="editor-grid">
      <fieldset>
        <legend>旅人 A</legend>
        ${fields("a")}
      </fieldset>
      <fieldset>
        <legend>旅人 B</legend>
        ${fields("b")}
      </fieldset>
    </div>
    <button type="submit" class="ghost">用这组重排</button>
  </form>`;
}

function renderFallback(insight) {
  if (!insight || !FAILURES.has(insight.reason)) return "";
  const title = FALLBACK_TITLES[insight.reason] || "Qloo 没接上，页面还在";
  const detail = insight.warning || "下面改用规则基线。票根和行程仍然显示。";
  return `<aside class="fallback reveal" role="status">
    <p class="seam-kicker">Fallback</p>
    <h2>${esc(title)}</h2>
    <p>${esc(detail)}</p>
  </aside>`;
}

function qlooNote(insight) {
  if (insight?.source === "unavailable") return `目的地无法验证 · 无可用路线。${insight.warning || "请补充城市或国家后重试。"}`;
  if (insight?.cacheLabel) return insight.cacheLabel;
  if (insight?.source === "live") {
    const city = insight.locality?.name ? `${insight.locality.name}。` : "";
    return `${city}实体和两边的亲和度来自 Qloo，来源标记是 qloo:entity。`;
  }
  return "这次是备用数据。没有调用 Qloo，或调用没有留下可用的餐饮和演出场地。这是规则基线，来源标记是 mock:fixture。";
}

function renderBoard(plan, input) {
  travelBooks.pair = createTravelBook({ route: plan.intersection, context: input.context, members: Object.values(plan.travelers), source: plan.insight?.source });
  const seamItems = plan.conflicts
    .map(
      (conflict) =>
        `<li><span>${esc(conflict.index)}</span>${esc(conflict.label)}<small>${esc(conflict.labelEn)}</small> ${tag(conflict.sourceTag)}</li>`,
    )
    .join("");

  const stops = plan.intersection.stops
    .map(
      (stop) => `<li class="stop" data-from="${esc(stop.from)}">
        <p class="when">${esc(stop.time)}</p>
        <h3>${esc(stop.name)} ${tag(stop.sourceTag)}</h3>
        <p class="stop-en">${esc(stop.nameEn)}</p>
        ${scorePair(stop)}
        <p>${esc(stop.detail)}</p>
        <p class="why-label">为什么两人都喜欢 · Why both will like it ${tag(stop.whySource || stop.sourceTag)}</p>
        <p class="why">${esc(stop.whyBoth)}</p>
        <p class="why-en">${esc(stop.whyBothEn)}</p>
      </li>`,
    )
    .join("");

  const mode = sourceLine(plan.insight);

  return `${renderFallback(plan.insight)}
    <div class="pair" id="conflict">
      ${ticket("a", plan)}
      <div class="seam">
        <p class="seam-kicker">Conflict</p>
        <h2>冲突</h2>
        <ol>${seamItems}</ol>
      </div>
      ${ticket("b", plan)}
    </div>
    <div class="ix-slot" id="intersection">
      <section class="intersection" aria-labelledby="ix-title">
        <div class="joined">
          <i class="rail rail-a" aria-hidden="true"></i>
          <div class="joined-main">
            <p class="seam-kicker ix-kicker">Intersection · 重排</p>
            <h2 id="ix-title">交集</h2>
            <p class="ix-name">${esc(plan.intersection.name)} <span>${esc(plan.intersection.nameEn)}</span></p>
            <p class="mode-note">${esc(mode)}</p>
            <div class="perf" aria-hidden="true">${"<i></i>".repeat(14)}</div>
            <ol class="route">${stops}</ol>${bookEntry("pair", plan.intersection.stops.length)}
            <p class="fine">${esc(qlooNote(plan.insight))}</p>
          </div>
          <i class="rail rail-b" aria-hidden="true"></i>
        </div>
      </section>
    </div>
    ${renderEditor(input)}`;
}

function sourceLine(insight) {
  if (!insight) return "这次是备用数据 · mock:fixture";
  if (insight.source === "unavailable") return `目的地无法验证 · 无可用路线。${insight.warning || "请补充城市或国家后重试。"}`;
  if (insight.cacheLabel) return insight.cacheLabel;
  if (insight.source === "live") {
    const city = insight.locality?.name ? `${insight.locality.name} · ` : "";
    return `${city}Qloo live · qloo:entity`;
  }
  return `这次是备用数据 · mock:fixture · ${insight.warning || "没有调用 Qloo"}`;
}

const STEPS = [
  ["parse", "01", "解析口味"],
  ["qloo", "02", "询问 Qloo"],
  ["conflicts", "03", "标出冲突"],
  ["reorder", "04", "重排路线"],
];

function renderShell() {
  const items = STEPS.map(
    ([id, index, name]) => `<li data-step="${id}" data-status="pending">
      <p class="step-index">${index}</p>
      <p class="step-name">${name}</p>
      <p class="step-result">等待</p>
    </li>`,
  ).join("");
  return `<div class="board reveal" id="board">
    <p class="agent-kicker">Agent</p>
    <ol class="steps">${items}</ol>
    <div id="playfield"></div>
  </div>`;
}

function stepText(id, status, result, error) {
  if (status === "running") return "进行中";
  if (status === "error") return error?.message || "失败";
  if (status !== "done") return "等待";
  if (id === "parse") {
    return `A ${result.a.map((item) => item.value).join(" / ")} · B ${result.b.map((item) => item.value).join(" / ")}`;
  }
  if (id === "qloo") {
    const names = [...result.entities.a, ...result.entities.b]
      .map((entity) => (typeof entity.affinity === "number" ? `${entity.name} ${entity.affinity.toFixed(2)}` : entity.name))
      .join(" · ");
    const via = result.cacheLabel
      ? result.cacheLabel
      : result.source === "live"
        ? "Qloo · qloo:entity"
        : "这次是备用数据 · mock:fixture";
    const cache = "";
    const warning = result.warning ? ` · ${result.warning}` : "";
    return `${via}${cache} · ${names}${warning}`;
  }
  if (id === "conflicts") {
    return result.length
      ? result.map((conflict) => `${conflict.label} / ${conflict.labelEn}${conflict.sourceTag ? ` ${conflict.sourceTag}` : ""}`).join(" · ")
      : "没有互相否决的口味";
  }
  const mark = result.sourceTag ? ` ${result.sourceTag}` : "";
  return `${result.name}${mark} · ${result.stops.map((stop) => `${stop.time} ${stop.name}`).join(" → ")}`;
}

function paintStep({ id, status, result, error }) {
  const item = document.querySelector(`[data-step="${id}"]`);
  if (!item) return;
  item.dataset.status = status;
  const resultNode = item.querySelector(".step-result");
  if (resultNode) resultNode.textContent = stepText(id, status, result, error);
}

function renderError(reason, input) {
  return `<section class="miss" id="conflict">
      <p class="seam-kicker">Conflict</p>
      <h2>还不能拼</h2>
      <p>${esc(reason)}</p>
    </section>
    ${renderEditor(input)}`;
}

function setShellStep(step) {
  document.querySelectorAll("[data-shell-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.shellPanel === step);
  });
  document.querySelectorAll("[data-shell-nav]").forEach((button) => {
    const active = button.dataset.shellNav === step;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "step" : "false");
  });
  armReveal();
}

function bindShell() {
  const shell = document.querySelector("#app-shell");
  if (!shell) return;
  shell.addEventListener("click", (event) => {
    const bookButton = event.target.closest("[data-book-open]");
    if (bookButton) {
      const kind = bookButton.dataset.bookOpen;
      if (travelBooks[kind]) openTravelBook(travelBooks[kind], bookButton, (destination) => {
        setShellStep(destination === "edit" && kind === "members" ? "members" : "negotiation");
        const target = destination === "edit"
          ? document.querySelector(kind === "members" ? "#members-workspace input" : "#retaste input")
          : bookButton;
        target?.focus();
        target?.scrollIntoView({ block: "nearest" });
      });
    }
    const nav = event.target.closest("[data-shell-nav]");
    if (nav) setShellStep(nav.dataset.shellNav);
    const next = event.target.closest("[data-shell-next]");
    if (next) setShellStep(next.dataset.shellNext);
  });
}

function renderHome() {
  return `<div class="app-shell" id="app-shell">
    <header class="shell-nav">
      <p class="shell-brand">TASTETRIP <span>合味旅行</span></p>
      <nav aria-label="TasteTrip steps">
        <button type="button" class="shell-nav-item is-active" data-shell-nav="members" aria-current="step"><b>01</b> 成员输入</button>
        <button type="button" class="shell-nav-item" data-shell-nav="qloo" aria-current="false"><b>02</b> Qloo 结果</button>
        <button type="button" class="shell-nav-item" data-shell-nav="negotiation" aria-current="false"><b>03</b> 协商路线</button>
      </nav>
      <p class="shell-source">QLOO SOURCE · DESIGN EXAMPLE</p>
    </header>
    <div class="shell-layout">
      <aside class="shell-rail">
        <p class="seam-kicker">TasteTrip · 多人协商</p>
        <h1>一群人的口味<br>拼成一条路</h1>
        <p class="shell-rail-copy">纸票根保留每个人的声音。三步看见成员、Qloo 信号和让步轨迹。</p>
        <div class="shell-demo-actions">
          <button type="button" class="play" id="play">一键试玩双人基线</button>
          <button type="button" class="ghost" id="preview-offline">预览断网回退</button>
          <button type="button" class="ghost" id="preview-rate">预览限流回退</button>
        </div>
        <p class="shell-rail-note">A ${esc(DEMO_INPUT.a.join(" / "))}<br>B ${esc(DEMO_INPUT.b.join(" / "))}</p>
      </aside>
      <main class="shell-main">
        <section class="shell-step is-active" data-shell-panel="members">
          ${renderMembersWorkspace(DEFAULT_MEMBERS, DEFAULT_CONTEXT)}
        </section>
        <section class="shell-step" data-shell-panel="qloo">
          <div id="members-result"><div class="shell-empty"><p class="seam-kicker">02 · Qloo result</p><h2>等待成员实体和评分矩阵</h2><p>提交成员线束后，这里展示来源标签、缺失评分、硬拒绝和群体公平摘要。</p></div></div>
        </section>
        <section class="shell-step" data-shell-panel="negotiation">
          <div id="members-route">
            <div class="shell-empty shell-empty-route"><p class="seam-kicker">03 · Negotiation</p><h2>路线会在这里被重新排序</h2><p>拒绝某站、照顾某位成员或缩短路线后，系统只重算受影响的部分。</p></div>
          </div>
          <div id="stage" hidden></div>
        </section>
      </main>
    </div>
    <div id="status" class="visually-hidden" role="status"></div>
  </div>`;
}

function columnBody(conflicts, route) {
  const clash = conflicts
    .map((conflict) => `<li>${esc(conflict.label)}：${esc(conflict.a.title)} / ${esc(conflict.b.title)} ${tag(conflict.sourceTag)}</li>`)
    .join("");
  const stops = route.stops
    .map((stop) => {
      const scores =
        "affinityA" in stop || "affinityB" in stop
          ? `<br>A ${typeof stop.affinityA === "number" ? stop.affinityA.toFixed(2) : "—"} · B ${typeof stop.affinityB === "number" ? stop.affinityB.toFixed(2) : "—"}`
          : "";
      return `<li>${esc(stop.time)} ${esc(stop.name)} ${tag(stop.sourceTag)}${scores}<br>${esc(stop.whyBoth)} ${tag(stop.whySource || stop.sourceTag)}</li>`;
    })
    .join("");
  return `<ol>${clash}</ol><ol>${stops}</ol>`;
}

function renderCompare(columns) {
  const tastes = `A ${DEMO_INPUT.a.join(" / ")} · B ${DEMO_INPUT.b.join(" / ")}`;
  const left = !columns
    ? ""
    : columns.qloo.source === "live"
      ? `<p class="tag">qloo:entity</p>
        <p>${esc(columns.qloo.cacheLabel || columns.qloo.warning || "")}</p>
        <p>${esc(columns.qlooRoute.name)} / ${esc(columns.qlooRoute.nameEn)}</p>
        ${columnBody(columns.qlooConflicts, columns.qlooRoute)}
        <p class="col-note">左栏是这次 Qloo 搜索和洞察跑出来的结果，来源标记 qloo:entity。</p>`
      : `<p class="tag">等待正式接口</p>
        <p>${esc(columns.qloo.warning || "这次没有 Qloo 响应。")}</p>
        <p class="col-note">左栏不把规则基线写成图谱结果。服务器配上密钥并重新部署后，这里显示 Qloo 实体和 qloo:entity。</p>`;
  const grid = columns
    ? `<div class="compare-grid">
      <article class="col-qloo reveal">
        <p class="seam-kicker">Qloo</p>
        <h2>Qloo 管道</h2>
        ${left}
      </article>
      <article class="col-llm reveal">
        <p class="seam-kicker">Baseline</p>
        <h2>无图谱规则</h2>
        <p class="tag">mock:fixture</p>
        <p>${esc(columns.baseRoute.name)} / ${esc(columns.baseRoute.nameEn)}</p>
        ${columnBody(columns.baseConflicts, columns.baseRoute)}
        <p class="col-note">右栏不读 Qloo。同一对口味只走仓库里的规则。这里没有测量，也没有谁赢了。</p>
      </article>
    </div>`
    : `<p>正在跑两边。</p>`;
  return `<section class="compare">
    <p class="brand">TasteTrip · 对照</p>
    <h1>同一对口味，两条管道</h1>
    <p class="fine compare-note">左栏只在拿到 Qloo 响应时填实体和亲和度。右栏是不读图谱的规则，这次真的跑了。没有胜负，没有对比分数。</p>
    <p class="pair-line">${esc(tastes)}</p>
    <a class="ghost link" href="#play">回到试玩</a>
    ${grid}
  </section>`;
}

let previewMode = null;
let token = 0;

const qloo = createBrowserQlooClient({
  preview: () => previewMode,
});

const compareQloo = createBrowserQlooClient({
  preview: () => null,
});

function readForm(form) {
  const side = (name) => [0, 1, 2].map((index) => form.elements[`${name}-${index}`].value);
  return { a: side("a"), b: side("b") };
}

function bindEditor() {
  const form = document.querySelector("#retaste");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    run(readForm(form));
  });
}

function planFrom(outcome) {
  return {
    travelers: {
      a: { name: "旅人 A", tastes: outcome.parsed.a.map((item) => item.value) },
      b: { name: "旅人 B", tastes: outcome.parsed.b.map((item) => item.value) },
    },
    conflicts: outcome.conflicts,
    intersection: outcome.route,
    insight: outcome.insight,
  };
}

function revealRoute(current, reduce) {
  const stage = document.querySelector("#stage");
  const status = document.querySelector("#status");
  window.setTimeout(() => {
    if (current !== token || !stage) return;
    stage.classList.add("is-on");
    if (status) status.textContent = "两张票根已撕开。冲突在中间的裂口。";
  }, reduce ? 0 : 40);

  window.setTimeout(() => {
    if (current !== token) return;
    stage?.classList.add("is-joined");
    if (status) status.textContent = "行程已拼回一张。每一站都标了为什么两人都喜欢。";
    const ix = document.querySelector("#intersection");
    if (!ix || reduce) return;
    const top = ix.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.62) {
      ix.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, reduce ? 0 : 1100);
}

function armReveal(root = document) {
  const nodes = [...root.querySelectorAll(".reveal:not(.is-in)")];
  if (!nodes.length) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.16, rootMargin: "0px 0px -6% 0px" },
  );
  nodes.forEach((node) => io.observe(node));
}

async function run(input) {
  const stage = document.querySelector("#stage");
  const status = document.querySelector("#status");
  if (!stage) return;
  const current = ++token;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setShellStep("negotiation");
  document.querySelector(".shell-empty-route")?.remove();
  const memberRoute = document.querySelector("#members-route");
  if (memberRoute) memberRoute.innerHTML = "";
  stage.hidden = false;
  stage.className = "stage";
  stage.innerHTML = renderShell();
  armReveal(stage);
  document.querySelector("#board")?.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });

  try {
    const outcome = await runPipeline(input, qloo, {
      dwellMs: reduce ? 0 : 500,
      shouldContinue: () => current === token,
      onStep: paintStep,
    });
    if (current !== token) return;
    const field = document.querySelector("#playfield");
    if (!field) return;
    field.innerHTML = renderBoard(planFrom(outcome), input);
    bindEditor();
    armReveal(field);
    revealRoute(current, reduce);
  } catch (error) {
    if (error?.code === "CANCELLED" || current !== token) return;
    const field = document.querySelector("#playfield");
    if (field) field.innerHTML = renderError(error.message || "重排没有完成。页面还在。", input);
    bindEditor();
    if (field) armReveal(field);
    if (status) status.textContent = error.message || "重排没有完成。";
  }
}

function mountHome() {
  token += 1;
  app.innerHTML = renderHome();
  armReveal(app);
  bindShell();
  document.querySelector("#play").addEventListener("click", () => {
    previewMode = null;
    run(DEMO_INPUT);
  });
  document.querySelector("#preview-offline").addEventListener("click", () => {
    previewMode = "offline";
    run(DEMO_INPUT);
  });
  document.querySelector("#preview-rate").addEventListener("click", () => {
    previewMode = "rate_limit";
    run(DEMO_INPUT);
  });
  bindMembersWorkspace(DEFAULT_MEMBERS, DEFAULT_CONTEXT);
}

function bindMembersWorkspace(initialMembers, initialContext = DEFAULT_CONTEXT) {
  let members = initialMembers.map((member) => ({ ...member, preferences: [...member.preferences] }));
  let context = { ...initialContext };
  const replace = (next) => {
    members = next;
    const form = document.querySelector("#members-workspace");
    if (!form) return;
    context = readMembersContext(form);
    form.outerHTML = renderMembersWorkspace(members, context);
    bindMembersWorkspace(members, context);
  };
  const form = document.querySelector("#members-workspace");
  if (!form) return;
  form.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-member]");
    if (remove) {
      const current = readMembersForm(form);
      if (current.length > 1) replace(current.filter((_, index) => index !== Number(remove.dataset.removeMember)));
      return;
    }
    if (event.target.closest("#add-member")) {
      const current = readMembersForm(form);
      current.push({ id: `m${current.length + 1}`, name: `成员 ${current.length + 1}`, preferences: ["", "", ""], city: "", start: "", time: "", budget: "", hardRejections: "", softPreferences: "" });
      replace(current);
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    context = readMembersContext(form);
    const input = buildMembersRequest(readMembersForm(form), context);
    const resultNode = document.querySelector("#members-result");
    if (!resultNode) return;
    membersNegotiationState = null;
    resultNode.innerHTML = '<p class="members-loading">正在询问 members-harness…</p>';
    try {
      const result = await qloo.resolveMembers(input);
      const pairStage = document.querySelector("#stage");
      if (pairStage) pairStage.hidden = true;
      resultNode.innerHTML = renderMembersResult(result, input);
      const routeNode = document.querySelector("#members-route");
      if (routeNode) routeNode.innerHTML = renderMembersNegotiation(result, input);
      setShellStep("qloo");
      bindNegotiationPanel(result, input);
      armReveal(resultNode);
    } catch (error) {
      resultNode.innerHTML = `<p class="fallback" role="status">${esc(error?.message || "成员线束没有完成。页面还在。")} · mock:fixture</p>`;
      setShellStep("qloo");
    }
  });
}

async function mountCompare() {
  const current = ++token;
  app.innerHTML = renderCompare(null);
  const parsed = parseTastes(DEMO_INPUT);
  const qlooInsight = await compareQloo.resolvePair(parsed);
  if (current !== token || location.hash !== "#compare") return;
  const baseline = await createMockClient().resolvePair(parsed);
  const qlooConflicts = detectConflicts(parsed, qlooInsight);
  const baseConflicts = detectConflicts(parsed, baseline);
  app.innerHTML = renderCompare({
    qloo: qlooInsight,
    qlooConflicts,
    qlooRoute: reorderRoute(parsed, qlooConflicts, qlooInsight),
    baseConflicts,
    baseRoute: reorderRoute(parsed, baseConflicts, baseline),
  });
  armReveal(app);
}

function route() {
  if (location.hash === "#compare") {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
  mountHome();
}

window.addEventListener("hashchange", route);
route();

const initialPreview = new URLSearchParams(location.search).get("preview");
if (location.hash !== "#compare" && (initialPreview === "offline" || initialPreview === "rate_limit")) {
  previewMode = initialPreview;
  run(DEMO_INPUT);
}
