import "./style.css";
import { DEMO_INPUT, FIELD_LABELS, POSTER_COLORS, POSTER_INK } from "./data.js";
import { runPipeline } from "./pipeline/run.js";
import { createBrowserQlooClient } from "./qloo/browserClient.js";

const app = document.querySelector("#app");

const TEAR_V =
  "M0 0 H12 L7 16 H16 L6 32 H14 L8 48 H17 L5 64 H15 L7 80 H16 L6 96 H14 L9 112 H18 L5 128 H15 L8 144 H16 L6 160 H14 L8 176 H17 L5 192 H15 L7 208 H16 L6 224 H14 L9 240 H17 L5 256 H15 L8 272 H16 L6 288 H14 L8 304 H16 L10 320 H0 Z";

const TEAR_H =
  "M0 0 H320 V12 L304 7 L288 16 L272 6 L256 14 L240 5 L224 15 L208 6 L192 16 L176 5 L160 14 L144 6 L128 16 L112 5 L96 15 L80 6 L64 16 L48 5 L32 14 L16 6 L0 12 Z";

const FALLBACK_TITLES = {
  missing_key: "没有密钥，页面还在",
  offline: "代理没连上，页面还在",
  rate_limit: "限流了，页面还在",
  timeout: "超时了，页面还在",
  down: "Qloo 不可用，页面还在",
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
        `<p><span>${esc(conflict.label)}</span> ${esc(conflict[side].title)}</p>`,
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
      <p>一键试玩始终回到固定假数据。重排会先问服务器上的代理；没有密钥时仍用本地假数据。</p>
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
  if (!insight || insight.source !== "fallback") return "";
  const title = FALLBACK_TITLES[insight.reason] || "Qloo 没接上，页面还在";
  const detail = insight.warning || "下面改用本地假数据。票根和行程仍然显示。";
  return `<aside class="fallback reveal" role="status">
    <p class="seam-kicker">Fallback</p>
    <h2>${esc(title)}</h2>
    <p>${esc(detail)}</p>
  </aside>`;
}

function qlooNote(insight) {
  if (insight?.source === "live") {
    return "实体来自 Qloo。每站的理由仍是手写的，亲和度分数还没接上。";
  }
  if (insight?.source === "fallback") {
    return "Qloo 没有可用结果。每站的理由是手写的假文案，页面用本地行程顶上。";
  }
  return "没有调用 Qloo。每站的理由是手写的假文案。";
}

function renderBoard(plan, input) {
  const seamItems = plan.conflicts
    .map(
      (conflict) =>
        `<li><span>${esc(conflict.index)}</span>${esc(conflict.label)}<small>${esc(conflict.labelEn)}</small></li>`,
    )
    .join("");

  const stops = plan.intersection.stops
    .map(
      (stop) => `<li class="stop" data-from="${esc(stop.from)}">
        <p class="when">${esc(stop.time)}</p>
        <h3>${esc(stop.name)}</h3>
        <p class="stop-en">${esc(stop.nameEn)}</p>
        <p>${esc(stop.detail)}</p>
        <p class="why-label">为什么两人都喜欢 · Why both will like it</p>
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
  if (!insight) return "本地假数据";
  if (insight.source === "live") return "Qloo live · 实体来自接口 · 海报仍是 placeholder";
  if (insight.source === "fallback") return `回退到本地模拟 · ${insight.warning || "Qloo 失败"}`;
  return "模拟 Qloo · 没有调用接口 · 海报是 placeholder";
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
    const names = [...result.entities.a, ...result.entities.b].map((entity) => entity.name).join(" · ");
    const via = result.source === "live" ? "Qloo" : result.source === "fallback" ? "回退" : "模拟";
    const cache = result.cached ? " · 缓存" : "";
    const warning = result.warning ? ` · ${result.warning}` : "";
    return `${via}${cache} · ${names}${warning}`;
  }
  if (id === "conflicts") {
    return result.length
      ? result.map((conflict) => `${conflict.label} / ${conflict.labelEn}`).join(" · ")
      : "没有互相否决的口味";
  }
  return `${result.name} · ${result.stops.map((stop) => `${stop.time} ${stop.name}`).join(" → ")}`;
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
    <p class="fine">固定假数据。纸纹是 placeholder，不是海报。断网和限流预览只是界面状态，不是测到的真实故障。</p>
  </header>
  <div id="status" class="visually-hidden" role="status"></div>
  <div id="stage" hidden></div>`;
}

function renderCompare() {
  const tastes = `A ${DEMO_INPUT.a.join(" / ")} · B ${DEMO_INPUT.b.join(" / ")}`;
  return `<section class="compare">
    <p class="brand">TasteTrip · 对照</p>
    <h1>同一对口味，两条管道</h1>
    <p class="fine compare-note">两边都是占位。没有密钥，没有跑过模型，没有测量。所以这里没有分数，也没有谁赢了。</p>
    <p class="pair-line">${esc(tastes)}</p>
    <a class="ghost link" href="#play">回到试玩</a>
    <div class="compare-grid">
      <article class="col-qloo reveal">
        <p class="seam-kicker">Pipeline</p>
        <h2>Qloo 管道</h2>
        <p class="tag">placeholder · 没有调用 Qloo</p>
        <ol>
          <li>解析口味</li>
          <li>询问 Qloo（现在会落到本地假数据）</li>
          <li>标出冲突：城市气质，用餐方式</li>
          <li>重排：都会夜生活</li>
        </ol>
        <p>19:30 对称旅馆大堂 → 20:10 双柜台夜食堂 → 21:40 爵士转角 → 嘻哈地下室 → 23:15 天台双银幕</p>
        <p class="col-note">这四站是仓库里写好的假行程，用来占住左栏的形状。它们不是 Qloo 返回的地点。</p>
      </article>
      <article class="col-llm reveal">
        <p class="seam-kicker">LLM only</p>
        <h2>只靠语言模型</h2>
        <p class="tag">placeholder · 没有调用模型</p>
        <p>占位：把两边折成一个白天的中间点，粉彩和霓虹各留一半，晚饭选一家都能接受的馆子。</p>
        <p class="col-note">这段话是手写的版面填充。它不是模型输出，没有分数，也不能拿来和左栏比高低。</p>
      </article>
    </div>
  </section>`;
}

let previewMode = null;
let token = 0;

const qloo = createBrowserQlooClient({
  preview: () => previewMode,
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

function mountCompare() {
  token += 1;
  app.innerHTML = renderCompare();
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
