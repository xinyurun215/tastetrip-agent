import "./style.css";
import { DEMO_INPUT, FIELD_LABELS, POSTER_COLORS, POSTER_INK } from "./data.js";
import { detectConflicts } from "./pipeline/conflicts.js";
import { parseTastes } from "./pipeline/parse.js";
import { reorderRoute } from "./pipeline/reorder.js";
import { runPipeline } from "./pipeline/run.js";
import { createBrowserQlooClient } from "./qloo/browserClient.js";
import { createMockClient } from "./qloo/mock.js";

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

function bars() {
  const widths = [2, 4, 2, 2, 6, 2, 4, 2, 2, 5, 2, 3, 2, 6, 2, 2, 4, 2];
  return `<p class="bars" aria-hidden="true">${widths.map((width) => `<i style="width:${width}px"></i>`).join("")}</p>`;
}

function posters(side, tastes) {
  return tastes
    .map((taste, index) => {
      const background = POSTER_COLORS[side][index];
      const color = POSTER_INK[side][index];
      return `<li class="poster" style="background:${background};color:${color}">
        <span class="ph">placeholder</span>
        <span class="kind">${esc(FIELD_LABELS[index])}</span>
        <strong>${esc(taste)}</strong>
      </li>`;
    })
    .join("");
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
      <p class="stub-meta"><span>STUB ${who}</span><span>${esc(traveler.name)}</span><span>placeholder</span></p>
      <p class="serial">NO. ${who === "A" ? "104281" : "104282"}</p>
      <div class="posters">${posters(side, traveler.tastes)}</div>
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
  if (insight?.source === "live") {
    return "实体和亲和度来自 Qloo，来源标记是 qloo:entity。";
  }
  return "没有调用 Qloo。这是规则基线，来源标记是 mock:fixture。服务器配上密钥并重新部署后，标记应为 qloo:entity。";
}

function renderBoard(plan, input) {
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
            <ol class="route">${stops}</ol>
            <p class="fine">${esc(qlooNote(plan.insight))}</p>
          </div>
          <i class="rail rail-b" aria-hidden="true"></i>
        </div>
      </section>
    </div>
    ${renderEditor(input)}`;
}

function sourceLine(insight) {
  if (!insight) return "规则基线 · mock:fixture";
  if (insight.source === "live") return "Qloo live · qloo:entity · 海报仍是 placeholder";
  return `规则基线 · mock:fixture · ${insight.warning || "没有调用 Qloo"}`;
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
    const via =
      result.source === "live" ? "Qloo · qloo:entity" : "规则基线 · mock:fixture";
    const cache = result.cached ? " · 缓存" : "";
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

function renderHome() {
  return `<header class="hero reveal">
    <p class="brand">TasteTrip · 合味旅行</p>
    <h1>两个人的口味冲突<br>→ 找出重叠</h1>
    <div class="hero-actions">
      <button type="button" class="play" id="play">一键试玩</button>
      <button type="button" class="ghost" id="preview-offline">预览断网回退</button>
      <button type="button" class="ghost" id="preview-rate">预览限流回退</button>
      <a class="ghost link" href="#compare">对照页</a>
    </div>
    <p class="fine">固定这一对口味。没有服务器密钥时，一键试玩是规则基线，来源标记 mock:fixture。密钥只在服务器上，配好并重新部署后，冲突和行程来自 Qloo，标记 qloo:entity。纸纹是 placeholder，不是海报。断网和限流预览只是界面状态，不是测到的真实故障。</p>
  </header>
  <div id="status" class="visually-hidden" role="status"></div>
  <div id="stage" hidden></div>`;
}

function columnBody(conflicts, route) {
  const clash = conflicts
    .map((conflict) => `<li>${esc(conflict.label)}：${esc(conflict.a.title)} / ${esc(conflict.b.title)} ${tag(conflict.sourceTag)}</li>`)
    .join("");
  const stops = route.stops
    .map((stop) => `<li>${esc(stop.time)} ${esc(stop.name)} ${tag(stop.sourceTag)}<br>${esc(stop.whyBoth)} ${tag(stop.whySource || stop.sourceTag)}</li>`)
    .join("");
  return `<ol>${clash}</ol><ol>${stops}</ol>`;
}

function renderCompare(columns) {
  const tastes = `A ${DEMO_INPUT.a.join(" / ")} · B ${DEMO_INPUT.b.join(" / ")}`;
  const left = !columns
    ? ""
    : columns.qloo.source === "live"
      ? `<p class="tag">qloo:entity</p>
        <p>${esc(columns.qloo.warning || "")}</p>
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
  if (location.hash === "#compare") mountCompare();
  else mountHome();
}

window.addEventListener("hashchange", route);
route();

const initialPreview = new URLSearchParams(location.search).get("preview");
if (location.hash !== "#compare" && (initialPreview === "offline" || initialPreview === "rate_limit")) {
  previewMode = initialPreview;
  run(DEMO_INPUT);
}
