import "./style.css";
import { DEMO_INPUT, FIELD_LABELS, POSTER_COLORS, POSTER_INK } from "./data.js";
import { analyze } from "./analyze.js";

const app = document.querySelector("#app");

const TEAR_V =
  "M0 0 H12 L7 16 H16 L6 32 H14 L8 48 H17 L5 64 H15 L7 80 H16 L6 96 H14 L9 112 H18 L5 128 H15 L8 144 H16 L6 160 H14 L8 176 H17 L5 192 H15 L7 208 H16 L6 224 H14 L9 240 H17 L5 256 H15 L8 272 H16 L6 288 H14 L8 304 H16 L10 320 H0 Z";

const TEAR_H =
  "M0 0 H320 V12 L304 7 L288 16 L272 6 L256 14 L240 5 L224 15 L208 6 L192 16 L176 5 L160 14 L144 6 L128 16 L112 5 L96 15 L80 6 L64 16 L48 5 L32 14 L16 6 L0 12 Z";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function qlooNote() {
  const configured = String(import.meta.env.VITE_QLOO_API_KEY || "").trim().length > 0;
  if (configured) {
    return "检测到 VITE_QLOO_API_KEY 已设置。本页不显示密钥，也不发起 Qloo 请求。理由仍是假的。";
  }
  return "尚未配置 VITE_QLOO_API_KEY。理由是假的，之后才换成 Qloo affinity 分数。";
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

  return `<form class="editor" id="retaste">
    <div class="editor-copy">
      <h2>改这组口味</h2>
      <p>一键试玩始终回到固定假数据。这里的重排仍不请求 Qloo。</p>
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

  const mode =
    plan.mode === "canonical"
      ? "固定假数据 · 布达佩斯 / 爵士 / 火锅 × Marvel / 嘻哈 / 寿司"
      : "仍是本地假数据 · 改过的口味按同一条夜路规则重排";

  return `<div class="board" id="board">
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
            <p class="fine">${esc(qlooNote())}</p>
          </div>
          <i class="rail rail-b" aria-hidden="true"></i>
        </div>
      </section>
    </div>
    ${renderEditor(input)}
  </div>`;
}

function renderError(reason, input) {
  return `<div class="board" id="board">
    <section class="miss" id="conflict">
      <p class="seam-kicker">Conflict</p>
      <h2>还不能拼</h2>
      <p>${esc(reason)}</p>
    </section>
    ${renderEditor(input)}
  </div>`;
}

app.innerHTML = `<header class="hero">
    <p class="brand">TasteTrip · 合味旅行</p>
    <h1>两个人的口味冲突<br>→ 找出重叠</h1>
    <button type="button" class="play" id="play">一键试玩</button>
    <p class="fine">固定假数据。色块是 placeholder，不是海报。</p>
  </header>
  <div id="status" class="visually-hidden" role="status"></div>
  <div id="stage" hidden></div>`;

const stage = document.querySelector("#stage");
const status = document.querySelector("#status");
let token = 0;

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

function run(input) {
  const current = ++token;
  const result = analyze(input);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  stage.hidden = false;
  stage.className = "stage";
  stage.innerHTML = result.ok ? renderBoard(result.plan, input) : renderError(result.reason, input);
  bindEditor();
  document.querySelector("#board")?.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });

  if (!result.ok) {
    stage.classList.add("is-on", "is-joined");
    status.textContent = result.reason;
    return;
  }

  window.setTimeout(() => {
    if (current !== token) return;
    stage.classList.add("is-on");
    status.textContent = "两张票根已撕开。冲突在中间的裂口。";
  }, reduce ? 0 : 40);

  window.setTimeout(() => {
    if (current !== token) return;
    stage.classList.add("is-joined");
    status.textContent = "行程已拼回一张。每一站都标了为什么两人都喜欢。";
    const ix = document.querySelector("#intersection");
    if (!ix || reduce) return;
    const top = ix.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.62) {
      ix.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, reduce ? 0 : 1000);
}

document.querySelector("#play").addEventListener("click", () => {
  run(DEMO_INPUT);
});
