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
import { scoreFairness } from "./pipeline/fairness.js";
import { planRoute } from "./pipeline/routePlanner.js";
import { startReview, rejectReview, proposeReview, confirmReview, cancelReview, undoReview, selectReviewCandidate } from "./pipeline/negotiation.js";
import { t, getLanguage, chooseLanguage, hasLanguageChoice, messageFor } from "./i18n.js";
import { renderReviewEvidence, renderReviewRoute } from "./reviewView.js";
import { buildCommonComparison } from "./pipeline/commonCandidates.js";
import { buildCommonSearchRequest, buildConfirmedCommonRequest, commonReviewInput, renderEntityConfirmation, renderCommonComparison } from "./commonView.js";

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
  { id: "m1", name: "甲", preferences: ["", "", ""], city: "上海", start: "人民广场", time: "18:00-22:00", budget: "200", hardRejections: "", softPreferences: "" },
  { id: "m2", name: "乙", preferences: ["", "", ""], city: "上海", start: "人民广场", time: "18:00-22:00", budget: "200", hardRejections: "", softPreferences: "" },
  { id: "m3", name: "丙", preferences: ["", "", ""], city: "上海", start: "人民广场", time: "18:00-22:00", budget: "200", hardRejections: "", softPreferences: "" },
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
  const preferences = Array.isArray(member.preferences) ? member.preferences : ['', '', ''];
  const field = (key, title, hint = '') => `<label><span>${esc(t(title))}</span><input data-field="${key}" value="${esc(member[key])}" ${hint} autocomplete="off" /></label>`;
  return `<article class="member-card" data-member-index="${index}"><div class="member-card-head"><h3>${esc(t('成员 {n}', {n:index+1}))}</h3><button type="button" class="member-remove" data-remove-member="${index}">${esc(t('删除'))}</button></div>${field('name','称呼')}<div class="member-preferences">${['电影（可选）','音乐人（可选）','书籍（可选）'].map((label,i) => `<label><span>${esc(t(label))}</span><input class="member-preference" data-preference-index="${i}" value="${esc(preferences[i])}" autocomplete="off" /></label>`).join('')}</div><div class="member-context">${field('city','城市')}${field('start','起点')}${field('time','时间','placeholder="18:00-22:00"')}${field('budget','预算','inputmode="decimal"')}</div><div class="member-context member-constraints">${field('hardRejections','硬拒绝')}${field('softPreferences','软偏好')}</div></article>`;
}

function renderMembersWorkspace(members, context = DEFAULT_CONTEXT) {
  return `<form class="members-workspace" id="members-workspace"><div class="workspace-heading"><div><p class="seam-kicker">01 · ${esc(t('成员输入'))}</p><h2>${esc(t('把一群人的口味放上桌'))}</h2><p>${esc(t('每人可任选电影、音乐人、书籍，不必全部填写。先确认实体，再比较同一地点候选池。'))}</p></div><button type="submit" class="play">${esc(t('搜索并确认偏好实体'))}</button></div><fieldset class="trip-context"><legend>${esc(t('共同出行条件'))}</legend>${[['city','城市'],['start','起点'],['time','时间窗'],['budget','群组预算']].map(([key,label]) => `<label><span>${esc(t(label))}</span><input data-context="${key}" value="${esc(context[key])}" autocomplete="off" /></label>`).join('')}</fieldset><div class="members-grid" id="members-list">${members.map(renderMemberCard).join('')}</div><button type="button" class="ghost member-add" id="add-member">${esc(t('添加成员'))}</button></form>`;
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

let membersNegotiationState = null;
const travelBooks = { members: null, pair: null };

function bookEntry(kind, count) {
  return count ? `<div class="book-entry"><button type="button" class="play" data-book-open="${kind}">打开回忆画册 ↗</button><p>摄影示例可体验 · 行程草稿尚未全员确认</p></div>` : "";
}

let activeMembersResult = null;
let activeEntitySearch = null;
let entityChoices = {};
let activeMembersRequest = null;
let memberOperation = 0;
let memberAbort = null;
let shellStep = 'members';
let loadingMembers = false;
let memberError = null;
let draftMembers = DEFAULT_MEMBERS;
let draftContext = DEFAULT_CONTEXT;

function planMembersNegotiation(result, request, existingNegotiation) {
  if (result.mode === 'common-compare' || request.mode === 'common-compare') {
    const parsed = commonReviewInput(request);
    const comparison = buildCommonComparison(result);
    const evidence = comparison.candidates;
    // Reuse hard-exclusion checks only. Comparison ordering never combines affinities.
    const exclusions = scoreFairness({...parsed,candidates:evidence});
    const filteredIds = new Set(exclusions.filtered.map(item => item.id));
    const accepted = evidence.filter(item => !filteredIds.has(item.id));
    const fairness = {accepted,filtered:exclusions.filtered};
    const negotiation = existingNegotiation ?? {...startReview({...parsed,candidates:accepted,comparisonMode:true,initialSelection:[],maxStops:3}),comparisonResult:result};
    const route = planRoute({...parsed,candidates:negotiation.selected,preserveOrder:true});
    return {parsed,fairness,comparison:{...comparison,candidates:accepted,commonTop5Ids:comparison.commonTop5Ids.filter(id => !filteredIds.has(id))},negotiation,route,status:route.status};
  }
  const parsed = parseTastes(request);
  const evidence = [...new Map([...(result.suggestions || []), ...(existingNegotiation?.candidates || [])].map(item => [item.id, item])).values()];
  const fairness = scoreFairness({ members: parsed.members, context: parsed.context, candidates: evidence });
  const negotiation = existingNegotiation ?? startReview({ members: parsed.members, context: parsed.context, candidates: fairness.accepted });
  const route = planRoute({ members: parsed.members, context: parsed.context, candidates: negotiation.selected, preserveOrder: true });
  return { parsed, fairness, negotiation, route, status: route.status };
}

function renderMembersResult(result, request, existingNegotiation = null) {
  const planned = planMembersNegotiation(result, request, existingNegotiation);
  if (!existingNegotiation) membersNegotiationState = planned.negotiation;
  if (planned.comparison) return renderCommonComparison(result,planned.comparison,planned.negotiation,planned.fairness.filtered.length);
  return renderReviewEvidence(result, planned.fairness);
}

function renderMembersNegotiation(result, request, negotiation = membersNegotiationState) {
  const { parsed, route } = planMembersNegotiation(result, request, negotiation);
  // Preserve the existing album snapshot contract; the album implementation is untouched.
  travelBooks.members = createTravelBook({ route, context: request.context, members: parsed.members, candidates: result.suggestions || [], source: result.source });
  return renderReviewRoute(result, request, negotiation, route, {inputStale:memberError === 'input_changed'}) + bookEntry('members', route.stops.length);
}

function refreshMembersViews() {
  if (!activeMembersResult || !activeMembersRequest) return;
  document.querySelector('#members-result').innerHTML = renderMembersResult(activeMembersResult, activeMembersRequest, membersNegotiationState);
  document.querySelector('#members-route').innerHTML = renderMembersNegotiation(activeMembersResult, activeMembersRequest, membersNegotiationState);
  bindCommonSelection();
  bindNegotiationPanel();
  armReveal();
  document.querySelector('.review-diff')?.scrollIntoView?.({ block: 'start' });
}

function stopMemberOperation() {
  memberOperation += 1;
  memberAbort?.abort();
  memberAbort = null;
}

function bindCommonSelection() {
  const panel = document.querySelector('#members-result');
  if (!panel || activeMembersRequest?.mode !== 'common-compare') return;
  // The container persists while its contents change. Replace this handler to avoid duplicate decisions.
  panel.onclick = null;
  if (panel.commonSelectionHandler) panel.removeEventListener?.('click',panel.commonSelectionHandler);
  const handler = event => {
    const button = event.target.closest('[data-common-select]');
    const state = membersNegotiationState;
    if (!button || !state || Number(button.dataset.version) !== state.version || memberError) return;
    stopMemberOperation();
    membersNegotiationState = selectReviewCandidate(state,button.dataset.candidateId,state.version);
    setShellStep('negotiation',false);
    refreshMembersViews();
  };
  panel.commonSelectionHandler = handler;
  panel.addEventListener('click',handler);
}

function renderEntityChoices() {
  if (!activeEntitySearch || activeMembersResult) return;
  document.querySelector('#members-result').innerHTML = renderEntityConfirmation(activeEntitySearch,entityChoices);
  const form = document.querySelector('#entity-confirmation-form');
  form?.addEventListener('change',event => {
    if (!event.target.matches('[data-entity-choice]')) return;
    entityChoices[event.target.dataset.choiceKey] = event.target.value;
    document.querySelector('#entity-confirmation-error').textContent = '';
  });
  form?.addEventListener('submit',async event => {
    event.preventDefault();
    let input;
    try { input = buildConfirmedCommonRequest(activeEntitySearch,activeMembersRequest,entityChoices); }
    catch (error) { document.querySelector('#entity-confirmation-error').textContent = messageFor(error.code); return; }
    stopMemberOperation();
    const current = memberOperation;
    memberAbort = new AbortController();
    loadingMembers = true; memberError = null;
    renderLoadingOrError();
    try {
      const result = await qloo.compareCommonMembers(input,{signal:memberAbort.signal});
      if (current !== memberOperation) return;
      activeMembersRequest = input; activeMembersResult = result;
      membersNegotiationState = planMembersNegotiation(result,input).negotiation;
      loadingMembers = false; memberAbort = null;
      refreshMembersViews();
    } catch (error) {
      if (current !== memberOperation || error?.name === 'AbortError') return;
      loadingMembers = false; memberAbort = null; memberError = error.code || 'down'; renderLoadingOrError();
    }
  });
  armReveal();
}

function invalidateMemberInput() {
  stopMemberOperation();
  loadingMembers = false;
  activeEntitySearch = null; entityChoices = {};
  memberError = 'input_changed';
  if (membersNegotiationState?.pending || membersNegotiationState?.phase === 'checking') {
    membersNegotiationState = cancelReview(membersNegotiationState);
  }
  refreshMembersViews();
  renderLoadingOrError();
}

async function findReplacement() {
  const state = membersNegotiationState;
  if (!state) return;
  const version = state.version;
  membersNegotiationState = proposeReview(state, version);
  refreshMembersViews();
  if (membersNegotiationState.phase !== 'checking') return;
  const current = ++memberOperation;
  memberAbort = new AbortController();
  try {
    const common = activeMembersRequest.mode === 'common-compare';
    const result = common
      ? await qloo.compareCommonMembers(activeMembersRequest, {rejectedIds:state.rejectedIds,signal:memberAbort.signal})
      : await qloo.resolveMembers(activeMembersRequest, { rejectedIds: state.rejectedIds, recheck: true, signal: memberAbort.signal });
    if (current !== memberOperation || membersNegotiationState.version !== version) return;
    const fairness = common ? planMembersNegotiation(result,activeMembersRequest).fairness
      : scoreFairness({...parseTastes(activeMembersRequest),candidates:result.suggestions || []});
    membersNegotiationState = proposeReview(membersNegotiationState, version, fairness.accepted, { queried: true, error: result.source === 'live' ? null : result.reason || 'down' });
    if (common && result.source === 'live') {
      activeMembersResult = result;
      membersNegotiationState = {...membersNegotiationState,comparisonResult:result};
    }
  } catch (error) {
    if (current !== memberOperation || error?.name === 'AbortError') return;
    membersNegotiationState = proposeReview(membersNegotiationState, version, [], { queried: true, error: 'offline' });
  }
  if (current === memberOperation) { memberAbort = null; refreshMembersViews(); }
}

function bindNegotiationPanel() {
  const panel = document.querySelector('#members-route-panel');
  if (!panel) return;
  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-review]');
    if (!button || !membersNegotiationState || memberError === 'input_changed' || loadingMembers || Number(button.dataset.version) !== membersNegotiationState.version) return;
    const state = membersNegotiationState;
    const type = button.dataset.review;
    stopMemberOperation();
    if (type === 'reject') {
      membersNegotiationState = rejectReview(state, button.dataset.candidateId, state.version);
      findReplacement();
      return;
    }
    if (type === 'retry') {
      membersNegotiationState = { ...state, version: state.version + 1, phase: 'checking', notice: null, pending: null };
      findReplacement();
      return;
    }
    if (type === 'confirm' || type === 'confirm_site') membersNegotiationState = confirmReview(state, state.version, type === 'confirm_site' ? button.dataset.candidateId : null);
    if (type === 'cancel') membersNegotiationState = cancelReview(state);
    if (type === 'undo') {
      membersNegotiationState = undoReview(state);
      if (membersNegotiationState.comparisonResult) activeMembersResult = membersNegotiationState.comparisonResult;
    }
    refreshMembersViews();
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

function setShellStep(step, cancelPending = true) {
  if (cancelPending && step !== shellStep && (loadingMembers || membersNegotiationState?.pending || membersNegotiationState?.phase === 'checking')) {
    stopMemberOperation();
    if (loadingMembers) { loadingMembers = false; memberError = 'cancelled'; renderLoadingOrError(); }
    if (membersNegotiationState) { membersNegotiationState = cancelReview(membersNegotiationState); refreshMembersViews(); }
  }
  shellStep = step;
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
  return `<div class="app-shell" id="app-shell"><header class="shell-nav"><p class="shell-brand">TASTETRIP <span>合味旅行</span></p><nav aria-label="TasteTrip steps"><button type="button" class="shell-nav-item" data-shell-nav="members"><b>01</b> ${esc(t('成员输入'))}</button><button type="button" class="shell-nav-item" data-shell-nav="qloo"><b>02</b> ${esc(t('Qloo 结果'))}</button><button type="button" class="shell-nav-item" data-shell-nav="negotiation"><b>03</b> ${esc(t('协商路线'))}</button></nav><label class="language-switch">语言 / Language <select id="language-switch" aria-label="语言 / Language"><option value="zh" ${getLanguage()==='zh'?'selected':''}>中文</option><option value="en" ${getLanguage()==='en'?'selected':''}>English</option></select></label></header><div class="shell-layout"><aside class="shell-rail"><p class="seam-kicker">TasteTrip · ${esc(t('多人协商'))}</p><h1>${esc(t('一群人的口味'))}<br>${esc(t('拼成一条路'))}</h1><p class="shell-rail-copy">${esc(t('三步查看成员口味、Qloo 证据和待确认的修改。'))}</p><button type="button" class="ghost" id="new-york-example">${esc(t('填入纽约示例'))}</button><p class="shell-rail-note">${esc(t('示例仅填写输入；提交后才查询 Qloo。'))}</p></aside><main class="shell-main"><section class="shell-step" data-shell-panel="members">${renderMembersWorkspace(draftMembers,draftContext)}</section><section class="shell-step" data-shell-panel="qloo"><div id="members-result"><div class="shell-empty"><p class="seam-kicker">02 · Qloo</p><h2>${esc(t('等待成员实体和评分矩阵'))}</h2><p>${esc(t('提交成员信息后查看候选、来源、缺失评分和硬拒绝。'))}</p></div></div></section><section class="shell-step" data-shell-panel="negotiation"><div id="members-route"><div class="shell-empty"><p class="seam-kicker">03 · ${esc(t('协商路线'))}</p><h2>${esc(t('路线草案会显示在这里'))}</h2><p>${esc(t('否决后先排除站点；必要时补查 Qloo，再展示差异，由当前操作者确认。'))}</p></div></div><div id="stage" hidden></div></section></main></div><div id="status" class="visually-hidden" role="status"></div></div>`;
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

function renderLoadingOrError() {
  if (!loadingMembers && !memberError) return;
  document.querySelector('#members-result').innerHTML = loadingMembers
    ? `<p class="members-loading" role="status">${esc(t('正在查询 Qloo…'))}</p><button class="ghost" id="cancel-members">${esc(t('取消查询'))}</button>`
    : `<p class="review-notice" role="status">${esc(memberError === 'cancelled' ? t('已取消查询。') : messageFor(memberError))}</p><button class="ghost" data-shell-next="members">${esc(t('返回成员输入'))}</button>`;
  document.querySelector('#cancel-members')?.addEventListener('click', () => {
    stopMemberOperation(); loadingMembers = false; memberError = 'cancelled'; renderLoadingOrError();
  });
}

function mountHome() {
  app.innerHTML = renderHome();
  if (document.documentElement) document.documentElement.lang = getLanguage() === 'en' ? 'en' : 'zh-CN';
  bindShell();
  bindMembersWorkspace(draftMembers, draftContext);
  document.querySelector('#language-switch')?.addEventListener('change', (event) => {
    const form = document.querySelector('#members-workspace');
    if (form) { draftMembers = readMembersForm(form); draftContext = readMembersContext(form); }
    chooseLanguage(event.target.value);
    mountHome(); // Same request, version and pending proposal; never query on language change.
  });
  document.querySelector('#new-york-example')?.addEventListener('click', () => {
    setShellStep('members');
    invalidateMemberInput();
    draftContext = { city:'New York', start:'Washington Square Park', time:'18:00-22:00', budget:'200' };
    draftMembers = [
      {id:'m1',name:'Alex',preferences:['Dune','Miles Davis','Beloved']},
      {id:'m2',name:'Sam',preferences:['Amelie','Radiohead','']},
      {id:'m3',name:'Robin',preferences:['Interstellar','Nina Simone','The Little Prince']},
    ].map(member => ({...member,...draftContext,hardRejections:'',softPreferences:''}));
    mountHome();
  });
  refreshMembersViews();
  renderEntityChoices();
  renderLoadingOrError();
  setShellStep(shellStep, false);
  armReveal(app);
}

function bindMembersWorkspace(initialMembers, initialContext = DEFAULT_CONTEXT) {
  const form = document.querySelector('#members-workspace');
  if (!form) return;
  form.addEventListener('input',invalidateMemberInput);
  form.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-member]');
    const add = event.target.closest('#add-member');
    if (!remove && !add) return;
    invalidateMemberInput();
    let members = readMembersForm(form);
    draftContext = readMembersContext(form);
    if (remove && members.length > 1) members = members.filter((_,index)=>index !== Number(remove.dataset.removeMember));
    if (add) members.push({id:`m${members.length+1}`,name:t('成员 {n}',{n:members.length+1}),preferences:['','',''],city:'',start:'',time:'',budget:'',hardRejections:'',softPreferences:''});
    draftMembers = members;
    form.outerHTML = renderMembersWorkspace(members,draftContext);
    bindMembersWorkspace(members,draftContext);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    draftMembers = readMembersForm(form); draftContext = readMembersContext(form);
    const context = draftContext;
    stopMemberOperation();
    const current = memberOperation;
    memberAbort = new AbortController();
    membersNegotiationState = null; activeMembersResult = null; activeEntitySearch = null; entityChoices = {};
    loadingMembers = true; memberError = null;
    document.querySelector('#members-route').innerHTML = '';
    setShellStep('qloo', false); renderLoadingOrError();
    try {
      const input = buildCommonSearchRequest(draftMembers,context);
      activeMembersRequest = input;
      const result = await qloo.searchCommonMembers(input, {signal:memberAbort.signal});
      if (current !== memberOperation) return;
      loadingMembers = false; memberAbort = null;
      if (result.source !== 'live') { memberError = result.reason || 'down'; renderLoadingOrError(); return; }
      activeEntitySearch = result;
      renderEntityChoices();
    } catch (error) {
      if (current !== memberOperation || error?.name === 'AbortError') return;
      loadingMembers = false; memberError = error?.code || 'down'; renderLoadingOrError();
    }
  });
}

function renderLanguageGate() {
  const preferred = String(globalThis.navigator?.language || '').startsWith('zh') ? 'zh' : 'en';
  app.innerHTML = `<main class="language-gate"><p class="seam-kicker">TASTETRIP</p><h1>选择语言 / Choose your language</h1><form id="language-choice"><label><input type="radio" name="language" value="zh" ${preferred==='zh'?'checked':''}/>中文</label><label><input type="radio" name="language" value="en" ${preferred==='en'?'checked':''}/>English</label><button class="play" type="submit">确认 / Continue</button></form></main>`;
  document.querySelector('#language-choice')?.addEventListener('submit', (event) => {
    event.preventDefault(); chooseLanguage(event.currentTarget.querySelector('[name="language"]:checked').value); mountHome();
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
  if (hasLanguageChoice()) mountHome(); else renderLanguageGate();
}

window.addEventListener("hashchange", route);
route();
