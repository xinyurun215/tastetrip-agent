const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const present = (value) => value !== null && value !== undefined && String(value).trim() !== "";
const text = (value) => typeof value === "string" ? value.trim() : "";

function webUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

// A read-only view of the chosen route: never select, reorder or infer consensus.
export function createTravelBook({ route, context = {}, members = [], candidates, source }) {
  return {
    destination: text(context.city) || text(context.destination),
    date: text(context.date),
    time: text(context.time),
    members: members.map((member) => text(member.name)).filter(Boolean),
    budget: present(context.budget) ? String(context.budget) : "",
    demo: source !== "live",
    stops: (route?.stops || []).map((stop) => {
      const raw = candidates
        ? candidates.find((candidate) => String(candidate.id ?? candidate.candidateId) === String(stop.candidateId ?? stop.id)) || {}
        : stop;
      // The planner defaults missing cost to zero. Read the original candidate instead.
      const cost = raw.cost ?? raw.estimatedCost ?? raw.price;
      const amount = present(cost) && Number.isFinite(Number(cost)) && Number(cost) >= 0 ? String(cost) : "";
      const photo = webUrl(raw.image?.url || raw.imageUrl || raw.photo?.url);
      return {
        name: text(stop.name), time: text(stop.time), cost: amount,
        currency: text(raw.currency),
        reason: text(stop.reason) || text(stop.whyBoth),
        detail: text(stop.detail),
        source: text(stop.sourceTag) || (source === "live" ? "qloo:entity" : "mock:fixture"),
        photo, photoSource: webUrl(raw.image?.sourceUrl || raw.photo?.sourceUrl) || photo,
        photoCredit: text(raw.image?.credit || raw.photo?.credit),
      };
    }),
  };
}

const money = (amount, currency) => amount === "" ? "费用待补充" : `${amount}${currency ? ` ${currency}` : "（币种未提供）"}`;

export function renderBookPage(book, page) {
  if (!page) return `<article class="book-cover" aria-labelledby="book-page-title">
    <div class="book-cover-top"><span>合味旅行 · 行程留稿</span><span class="book-seal">草稿</span></div>
    <div class="book-cover-title"><p>${esc(book.destination || "目的地待补充")}</p><h2 id="book-page-title" tabindex="-1">合味行册</h2></div>
    <div class="book-cover-foot"><p>${esc(book.date || "日期待补充")}${book.time ? ` · ${esc(book.time)}` : ""}</p>
      <p>同行 · ${esc(book.members.join("、") || "同行者待补充")}</p>
      <p>${book.stops.length} 站${book.budget ? ` · 群体预算 ${esc(money(book.budget, ""))}` : ""}</p>
      <p class="book-disclaimer">${book.demo ? "演示 / 备用数据 · " : ""}尚未全员确认</p>
      <button type="button" class="book-primary" data-book-page="1" ${book.stops.length ? "" : "disabled"}>展开行册 <span aria-hidden="true">↗</span></button>
      ${book.stops.length ? "" : "<p>暂无已选站点，请返回协商路线。</p>"}
    </div></article>`;
  const stop = book.stops[page - 1];
  return `<article class="book-leaf" aria-labelledby="book-page-title">
    <header class="book-leaf-heading"><span>第 ${String(page).padStart(2, "0")} 站</span><span>${esc(stop.time || "时间待补充")}</span></header>
    <h2 id="book-page-title" tabindex="-1">${esc(stop.name || "地点待补充")}</h2>
    ${stop.photo ? `<figure class="book-photo"><img src="${esc(stop.photo)}" alt="${esc(stop.name)}的来源照片" referrerpolicy="no-referrer"><figcaption><a href="${esc(stop.photoSource)}" target="_blank" rel="noopener noreferrer">照片来源${stop.photoCredit ? ` · ${esc(stop.photoCredit)}` : ""}</a></figcaption></figure>` : '<div class="book-photo-empty"><span aria-hidden="true">留白</span><p>此站暂无来源照片</p></div>'}
    <div class="book-stop-copy"><p class="book-cost">${esc(money(stop.cost, stop.currency))}</p>
    ${stop.detail ? `<p>${esc(stop.detail)}</p>` : ""}
    <h3>现有选点依据</h3><p>${esc(stop.reason || "尚无选点说明，返回协商查看偏好。")}</p>
    <p class="book-source">${esc(stop.source)}${book.demo ? " · 演示 / 备用数据" : ""}</p></div>
    </article>`;
}

export function renderTravelBook(book) {
  return `<dialog class="travel-book" aria-labelledby="book-title" aria-describedby="book-notice">
    <header class="book-toolbar"><div><h2 id="book-title">合味行册</h2><p id="book-notice">行程草稿 · 评分与选点说明不代表全员确认</p></div><button type="button" data-book-close aria-label="关闭行册，返回原页面">关闭 ×</button></header>
    <div class="book-spread"><aside class="book-index"><p class="book-index-city">${esc(book.destination || "目的地待补充")}</p><details open><summary>目录 · ${book.stops.length} 站</summary><nav aria-label="行册目录"><button type="button" data-book-page="0" aria-current="page">封面</button>${book.stops.map((stop, index) => `<button type="button" data-book-page="${index + 1}"><span>${String(index + 1).padStart(2, "0")}</span> ${esc(stop.name || "地点待补充")}</button>`).join("")}</nav></details><p class="book-index-note">一站一页，留住各自的口味。<br>仍可返回协商，再作取舍。</p></aside>
    <div class="book-reading"><div class="book-page" data-book-content>${renderBookPage(book, 0)}</div>
    <nav class="book-pagination" aria-label="翻页"><button type="button" data-book-prev disabled>上一页</button><span data-book-position role="status" aria-live="polite">封面</span><button type="button" data-book-next ${book.stops.length ? "" : "disabled"}>下一页</button></nav></div></div>
    <footer class="book-footer"><button type="button" data-book-return="negotiation">返回协商路线</button><button type="button" data-book-return="edit">修改偏好</button><span>← → 翻页 · Esc 关闭</span></footer>
  </dialog>`;
}

export function openTravelBook(book, trigger, onReturn) {
  document.querySelector(".travel-book")?.close();
  document.body.insertAdjacentHTML("beforeend", renderTravelBook(book));
  const dialog = document.querySelector(".travel-book");
  if (window.matchMedia("(max-width: 640px)").matches) dialog.querySelector("details").open = false;
  const content = dialog.querySelector("[data-book-content]");
  let page = 0;
  let returnTo = null;
  function show(next) {
    const target = Math.max(0, Math.min(book.stops.length, next));
    if (target === page) return;
    const backward = target < page;
    page = target;
    content.innerHTML = renderBookPage(book, page);
    content.classList.toggle("book-backward", backward);
    // Restart the restrained page-turn animation, with CSS reduced-motion fallback.
    content.classList.remove("book-turn");
    void content.offsetWidth;
    content.classList.add("book-turn");
    dialog.querySelectorAll(".book-index [data-book-page]").forEach((button) => {
      button.setAttribute("aria-current", Number(button.dataset.bookPage) === page ? "page" : "false");
    });
    dialog.querySelector("[data-book-prev]").disabled = page === 0;
    dialog.querySelector("[data-book-next]").disabled = page === book.stops.length;
    dialog.querySelector("[data-book-position]").textContent = page ? `第 ${page} / ${book.stops.length} 站` : "封面";
    content.querySelector("h2").focus({ preventScroll: true });
    content.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  dialog.addEventListener("error", (event) => {
    if (event.target.tagName === "IMG") {
      event.target.parentElement.outerHTML = '<div class="book-photo-empty"><p>来源照片暂时无法加载</p></div>';
    }
  }, true);
  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-book-page")) show(Number(button.dataset.bookPage));
    if (button.hasAttribute("data-book-prev")) show(page - 1);
    if (button.hasAttribute("data-book-next")) show(page + 1);
    if (button.hasAttribute("data-book-close")) dialog.close();
    if (button.dataset.bookReturn) { returnTo = button.dataset.bookReturn; dialog.close(); }
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); show(page + (event.key === "ArrowRight" ? 1 : -1));
    }
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (returnTo) onReturn(returnTo);
    else trigger?.focus();
  }, { once: true });
  dialog.showModal();
  dialog.querySelector("[data-book-close]").focus();
}
