import "./style.css";
import { DEMO_INPUT, FIELD_LABELS } from "./data.js";
import { analyze } from "./analyze.js";

const app = document.querySelector("#app");

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
    return "检测到 VITE_QLOO_API_KEY 已设置。本页不显示密钥，也不发起 Qloo 请求。你看到的仍是假数据。";
  }
  return "尚未配置 VITE_QLOO_API_KEY。这是预期状态：真实 Qloo 接入还没做，演示只用仓库里的固定假数据。";
}

function personFields(side, legend) {
  const tastes = DEMO_INPUT[side];
  const inputs = FIELD_LABELS.map((label, index) => {
    return `<label>
      <span>${esc(label)}</span>
      <input name="${side}-${index}" value="${esc(tastes[index])}" autocomplete="off" />
    </label>`;
  }).join("");

  return `<fieldset class="person person-${side}">
    <legend>${esc(legend)}</legend>
    ${inputs}
  </fieldset>`;
}

function renderConflict(plan) {
  const cards = plan.conflicts
    .map(
      (conflict) => `<article class="clash">
        <header class="clash-label">
          <span class="idx">${esc(conflict.index)}</span>
          <h3>${esc(conflict.label)}</h3>
          <p class="en">${esc(conflict.labelEn)}</p>
        </header>
        <div class="clash-split">
          <div class="side side-a">
            <p class="who">旅人 A</p>
            <h4>${esc(conflict.a.title)}</h4>
            <p>${esc(conflict.a.detail)}</p>
          </div>
          <div class="versus"><span>对不上</span></div>
          <div class="side side-b">
            <p class="who">旅人 B</p>
            <h4>${esc(conflict.b.title)}</h4>
            <p>${esc(conflict.b.detail)}</p>
          </div>
        </div>
      </article>`,
    )
    .join("");

  return `<section id="conflict" class="conflict wrap" aria-labelledby="conflict-title">
    <header class="section-head">
      <p class="stamp stamp-conflict">Conflict</p>
      <h2 id="conflict-title">冲突点</h2>
      <p class="section-lede">这两处对不上。若按各自的白天排，路线会拆成两条，谁也走不完对方的城市。</p>
    </header>
    <div class="displaced">
      <p class="displaced-kicker">不采用的白天 · Daytime plans set aside</p>
      <div>
        <p><span>A</span>${esc(plan.displaced.a.join(" → "))}</p>
        <p><span>B</span>${esc(plan.displaced.b.join(" → "))}</p>
      </div>
    </div>
    <div class="clash-list">${cards}</div>
  </section>`;
}

function renderIntersection(plan) {
  const ix = plan.intersection;
  const summary = ix.summary
    .map(([time, name]) => `<li><time>${esc(time)}</time>${esc(name)}</li>`)
    .join("");
  const stops = ix.stops
    .map(
      (stop) => `<li class="stop">
        <div class="stop-body">
          <div class="stop-head">
            <time datetime="${esc(stop.time)}">${esc(stop.time)}</time>
            <h3>${esc(stop.name)}</h3>
          </div>
          <p class="en">${esc(stop.nameEn)}</p>
          <p>${esc(stop.detail)}</p>
        </div>
      </li>`,
    )
    .join("");
  const modeNote =
    plan.mode === "canonical"
      ? "固定假数据 · 布达佩斯 / 爵士 / 火锅 × Marvel / 嘻哈 / 寿司"
      : "仍是本地假数据 · 你改过口味，夜路按同一规则重排，不是 Qloo 结果";

  return `<section id="intersection" class="intersection" aria-labelledby="intersection-title">
    <div class="wrap">
      <p class="reorder-flag">Reorder · 重排 — 从这里起只剩一条夜路</p>
      <header class="section-head">
        <p class="stamp stamp-intersection">Intersection</p>
        <h2 id="intersection-title">交集路线</h2>
        <p class="ix-name">${esc(ix.name)} <span>${esc(ix.nameEn)}</span></p>
        <p class="section-lede">${esc(ix.why)}</p>
        <p class="en-note">${esc(ix.whyEn)}</p>
      </header>
      <ol class="summary">${summary}</ol>
      <p class="mode-note">${esc(modeNote)}</p>
      <ol class="route">${stops}</ol>
      <footer class="site-footer">
        <p>TasteTrip 合味旅行 · 最小演示。真实口味图谱计划接入 Qloo，本页不会代替那次接入。</p>
        <p>${esc(qlooNote())}</p>
      </footer>
    </div>
  </section>`;
}

function renderDossier(result) {
  if (!result.ok) {
    return `<section class="empty wrap" id="conflict">
      <p class="stamp stamp-conflict">Conflict</p>
      <h2>还不能重排</h2>
      <p>${esc(result.reason)}</p>
      <p class="action-note">${esc(qlooNote())}</p>
    </section>`;
  }

  const { plan } = result;
  return `${renderConflict(plan)}
    ${renderIntersection(plan)}`;
}

function readInput(form) {
  const readSide = (side) =>
    [0, 1, 2].map((index) => form.elements[`${side}-${index}`].value);
  return { a: readSide("a"), b: readSide("b") };
}

function fillDemo(form) {
  for (const side of ["a", "b"]) {
    DEMO_INPUT[side].forEach((value, index) => {
      form.elements[`${side}-${index}`].value = value;
    });
  }
}

app.innerHTML = `<header class="hero wrap">
    <div>
      <p class="kicker">Qloo Agentic Hackathon · Fake data only</p>
      <h1>TasteTrip</h1>
      <p class="zh-title">合味旅行</p>
      <p class="lede">两个人口味冲突的时候，不取平均。先标出对不上的点，再把行程重排到两边都站得住的交集上。</p>
      <p class="lede-en">Name the conflict. Reorder the route around the intersection.</p>
    </div>
    <aside class="hero-card">
      <p>打开即演示</p>
      <ul>
        <li>旅人 A · 布达佩斯大饭店 / 爵士 / 火锅</li>
        <li>旅人 B · Marvel / 嘻哈 / 寿司</li>
        <li>冲突看暖红对冷蓝，交集看深夜金线</li>
      </ul>
    </aside>
  </header>
  <nav class="jumps wrap" aria-label="结果段落">
    <a href="#conflict">冲突点 Conflict</a>
    <a href="#intersection">交集路线 Intersection</a>
  </nav>
  <form class="wrap tastes" id="tastes">
    <div class="form-head">
      <h2>两人的口味</h2>
      <p>默认就是今晚的固定假数据。可以改字，再重排；恢复演示会回到上面这一对。</p>
    </div>
    <div class="people">
      ${personFields("a", "旅人 A")}
      ${personFields("b", "旅人 B")}
    </div>
    <div class="actions">
      <button type="submit" class="primary">用这两人的口味重排</button>
      <button type="button" class="ghost" id="reset">恢复演示数据</button>
      <p class="action-note">结果写在页面里，不发网络请求。</p>
    </div>
  </form>
  <div id="status" class="visually-hidden" role="status"></div>
  <div id="dossier"></div>`;

const form = document.querySelector("#tastes");
const dossier = document.querySelector("#dossier");
const status = document.querySelector("#status");

function paint() {
  const result = analyze(readInput(form));
  dossier.innerHTML = renderDossier(result);
  status.textContent = result.ok
    ? "已标出冲突点，并给出交集夜路。"
    : result.reason;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  paint();
  document.querySelector("#conflict")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("#reset").addEventListener("click", () => {
  fillDemo(form);
  paint();
});

paint();
